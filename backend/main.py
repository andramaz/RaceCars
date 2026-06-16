"""
main.py — FastAPI backend for the RC Car Control Platform.

Responsibilities:
  - Accept WebSocket connections from the React Native app
  - Receive steering / throttle / emergency-stop commands
  - Forward commands to the ESP32 via esp32_client
  - Poll the ESP32 for real telemetry every 500 ms (falls back to simulation)
  - Implement fail-safe logic (throttle = 0 if no command for >1 s)
  - Expose REST endpoint GET /api/race-summary

Run with:
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

import asyncio
import json
import time
import random

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from database import (
    save_telemetry, get_race_summary,
    new_session, current_session, get_sessions, get_session_data,
    arm_session, end_session,
    INFLUX_ENABLED,
)
import esp32_client
from lap_timer import lap_timer

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="RC Car Control Backend", version="1.0.0")

# Allow all origins so the React Native / Expo app can connect without CORS issues.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Shared car state
# ---------------------------------------------------------------------------

class CarState:
    """Holds the current state of the RC car (or its simulation)."""

    def __init__(self) -> None:
        self.steering:           int   = 0      # -100 … +100
        self.throttle:           int   = 0      # 0 … 100
        self.mode:               str   = "manual"
        self.emergency_stop:     bool  = False
        self.fail_safe:          bool  = False
        self.last_command_time:  float = time.time()
        self.battery_percentage: float = 100.0
        self.battery_voltage:    float = 8.4
        # Motor state tracking for ARM-based session management
        self.prev_mstate:        str   = ""
        self.grace_task:         object = None  # asyncio.Task | None


# One shared instance for the prototype (single-car, single-session).
car = CarState()

# ── ARM-based session management ───────────────────────────────────────────

WALL_GRACE_SECONDS = 60  # re-arm window after wall-triggered EMERGENCY


async def _grace_period_timer() -> None:
    """Wait WALL_GRACE_SECONDS; if car is still not ARMED, end the session."""
    await asyncio.sleep(WALL_GRACE_SECONDS)
    print(f"[SESSION] Grace period expired — ending session (no re-arm within {WALL_GRACE_SECONDS}s)")
    end_session()
    car.grace_task = None


def _on_motor_state_change(new_mstate: str) -> None:
    """
    React to motor-state transitions reported by the ESP32.

    ARMED        → start (or resume) a session
    ARMED→EMERG  → wall recovery likely; start 60 s grace period
    ARMED→DISARM → immediate session end
    EMERG→ARMED  → cancel grace period, resume session
    EMERG→DISARM → cancel grace period, end session
    """
    prev = car.prev_mstate
    if new_mstate == prev:
        return  # no change
    car.prev_mstate = new_mstate

    print(f"[SESSION] Motor state: {prev!r} → {new_mstate!r}")

    if new_mstate == "ARMED":
        # Cancel any running grace period (wall re-arm)
        if car.grace_task and not car.grace_task.done():
            car.grace_task.cancel()
            car.grace_task = None
        arm_session("car_1")

    elif prev == "ARMED" and new_mstate == "EMERGENCY":
        # Wall-triggered emergency — start grace period instead of ending session
        print(f"[SESSION] EMERGENCY detected — starting {WALL_GRACE_SECONDS}s grace period")
        if car.grace_task and not car.grace_task.done():
            car.grace_task.cancel()
        car.grace_task = asyncio.create_task(_grace_period_timer())

    elif new_mstate == "DISARMED":
        # Cancel grace period if any, then end session
        if car.grace_task and not car.grace_task.done():
            car.grace_task.cancel()
            car.grace_task = None
        end_session()

# ---------------------------------------------------------------------------
# Safety / fail-safe logic
# ---------------------------------------------------------------------------

def check_fail_safe() -> None:
    """
    Activate fail-safe if no command has arrived for more than 1 second.
    This protects the car if the phone app loses connection or freezes.
    """
    elapsed = time.time() - car.last_command_time

    if elapsed > 1.0 and not car.emergency_stop:
        if car.throttle != 0 or not car.fail_safe:
            car.throttle  = 0
            car.fail_safe = True
            print("[FAIL-SAFE] No command for >1 s — throttle forced to 0.")
    elif elapsed <= 1.0 and car.fail_safe and not car.emergency_stop:
        # Commands are flowing again; clear fail-safe.
        car.fail_safe = False


async def process_command(data: dict) -> None:
    """Parse, apply, and forward one incoming command message from the app."""
    msg_type = data.get("type")

    if msg_type == "command":
        if car.emergency_stop:
            print("[BLOCKED] Command ignored — emergency stop is active.")
            return

        car.steering          = int(data.get("steering", 0))
        car.throttle          = int(data.get("throttle", 0))
        car.mode              = data.get("mode", "manual")
        car.last_command_time = time.time()
        car.fail_safe         = False

        print(
            f"[CMD RECEIVED] steering={car.steering:+d}  "
            f"throttle={car.throttle}  mode={car.mode}"
        )
        await esp32_client.send_drive(car.steering, car.throttle)

    elif msg_type == "emergency_stop":
        car.emergency_stop = True
        car.throttle       = 0
        print("[EMERGENCY STOP] ACTIVATED — all throttle commands blocked.")
        await esp32_client.send_emergency()

    elif msg_type == "reset_emergency_stop":
        car.emergency_stop    = False
        car.fail_safe         = False
        car.last_command_time = time.time()
        print("[EMERGENCY STOP] Reset — commands accepted again.")

    elif msg_type == "arm":
        print("[ARM] Arming motors.")
        await esp32_client.send_arm(True)

    elif msg_type == "disarm":
        car.throttle = 0
        print("[DISARM] Disarming motors.")
        await esp32_client.send_arm(False)

    else:
        print(f"[UNKNOWN MSG TYPE] {msg_type}")

# ---------------------------------------------------------------------------
# Telemetry generation (fake / simulated)
# ---------------------------------------------------------------------------

async def generate_telemetry() -> dict:
    """
    Build a telemetry snapshot.
    Tries to get real sensor data from the ESP32 first.
    Falls back to simulation if the ESP32 is not connected yet.
    """
    check_fail_safe()

    esp32_data = await esp32_client.fetch_telemetry()

    if esp32_data:
        t = esp32_data.get("telemetry", {})

        # Helper: treat JSON null as a fallback value
        def _n(v, default):
            return v if v is not None else default

        # Battery
        battery            = t.get("battery", {})
        battery_percentage = _n(battery.get("pct"), car.battery_percentage)
        battery_voltage    = _n(battery.get("v"),   car.battery_voltage)
        car.battery_percentage = battery_percentage
        car.battery_voltage    = battery_voltage

        # Signal quality from RSSI
        rssi = t.get("wireless", {}).get("rssi", -999)
        if rssi >= -60:
            signal_quality = "good"
        elif rssi >= -75:
            signal_quality = "medium"
        else:
            signal_quality = "poor"

        # Real steering + throttle from ESP32 control block, using live config
        control  = t.get("control", {})
        servo_us = _n(control.get("servoUs"), None)
        esc_us   = _n(control.get("escUs"),   None)
        if servo_us is not None:
            car.steering = esp32_client.servo_us_to_pct(servo_us)
        if esc_us is not None:
            car.throttle = esp32_client.esc_us_to_pct(esc_us)

        # Estimate speed from real throttle (no encoder yet)
        speed = round((car.throttle / 100) * 4.0, 2)

        # Sync emergency and mode from ESP32 system state
        system = t.get("system", {})
        mstate = system.get("mstate", "UNKNOWN")
        if mstate == "EMERGENCY" or system.get("emergency", False):
            car.emergency_stop = True
        elif mstate == "DISARMED":
            car.emergency_stop = False

        # ARM-based session management
        _on_motor_state_change(mstate)

        print(f"[ESP32] Telemetry OK — mstate={mstate}  servoUs={servo_us}  steer={car.steering}%  escUs={esc_us}  thr={car.throttle}%")

        # Lap detection — check sonar gate each tick
        lap_timer.check(t.get("sonar"))
    else:
        # Simulated fallback — ESP32 not connected yet
        t = {}
        speed = max(0.0, round((car.throttle / 100) * 4.0 + random.uniform(-0.05, 0.05), 2))
        car.battery_percentage = max(0.0, car.battery_percentage - 0.01)
        car.battery_voltage    = round(6.0 + (car.battery_percentage / 100) * 2.4, 2)
        battery_percentage = car.battery_percentage
        battery_voltage    = car.battery_voltage

        roll = random.random()
        if roll > 0.90:
            signal_quality = "poor"
        elif roll > 0.65:
            signal_quality = "medium"
        else:
            signal_quality = "good"

    esp32_system = esp32_data.get("telemetry", {}).get("system", {}) if esp32_data else {}

    telemetry = {
        "type":               "telemetry",
        "car_id":             "car_1",
        "timestamp":          int(time.time()),
        "speed":              speed,
        "battery_percentage": round(battery_percentage, 1),
        "battery_voltage":    battery_voltage,
        "current_steering":   car.steering,
        "current_throttle":   car.throttle,
        "signal_quality":     signal_quality,
        "emergency_stop":     car.emergency_stop,
        "fail_safe":          car.fail_safe,
        "mode":               car.mode,
        "motor_state":        esp32_system.get("mstate", "UNKNOWN"),
        "lap_count":          lap_timer.lap_count,
        "last_lap_s":         lap_timer.last_lap,
        "best_lap_s":         lap_timer.best_lap,
    }

    # Attach real sensor data from ESP32 if available
    if esp32_data:
        for key in ("sonar", "lidar", "imu", "odometry", "control", "system", "wireless", "limits"):
            if key in t:
                telemetry[key] = t[key]

    save_telemetry(telemetry)
    return telemetry

# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """
    Main real-time channel between the app and the backend.

    - Receives command / emergency_stop / reset_emergency_stop messages.
    - Sends a telemetry snapshot every 500 ms on a background task.
    """
    await websocket.accept()
    lap_timer.reset()
    session_id = new_session()
    print(f"[WS] App connected — session {session_id}")

    # Background task: push telemetry every 500 ms.
    async def telemetry_loop() -> None:
        while True:
            try:
                snapshot = await generate_telemetry()
                await websocket.send_json(snapshot)
            except WebSocketDisconnect:
                break
            except Exception as e:
                print(f"[TELEMETRY ERROR] {type(e).__name__}: {e}")
            await asyncio.sleep(0.5)

    telemetry_task = asyncio.create_task(telemetry_loop())

    try:
        while True:
            raw  = await websocket.receive_text()
            data = json.loads(raw)
            await process_command(data)

    except WebSocketDisconnect:
        print("[WS] App disconnected.")
        # Trigger fail-safe immediately on disconnect.
        car.throttle          = 0
        car.fail_safe         = True
        car.last_command_time = 0.0   # force fail-safe on next tick

    except Exception as e:
        print(f"[WS ERROR] {e}")

    finally:
        telemetry_task.cancel()

# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@app.get("/api/race-summary")
async def race_summary_endpoint() -> dict:
    return get_race_summary()


@app.get("/api/history/sessions")
async def history_sessions_endpoint() -> dict:
    """List past race sessions stored in InfluxDB (last 30 days)."""
    return {
        "influx_enabled": INFLUX_ENABLED,
        "sessions":       get_sessions(limit=20),
    }


@app.get("/api/history/sessions/{session_id}")
async def history_session_detail_endpoint(session_id: str) -> dict:
    """Return time-series data + stats for a single past session."""
    return get_session_data(session_id)


@app.get("/")
async def root() -> dict:
    return {"status": "RC Car backend is running", "docs": "/docs"}
