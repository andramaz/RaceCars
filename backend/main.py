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
        self.motor_state:        str   = "UNKNOWN"  # last known good value from ESP32
        self.grace_task:         object = None  # asyncio.Task | None
        self.drive_task:         object = None  # asyncio.Task | None — latest in-flight send_drive


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


async def process_command(data: dict) -> dict | None:
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
        # Only one in-flight drive request at a time.
        # car.steering/throttle are already updated above — next completion picks them up.
        if car.drive_task is None or car.drive_task.done():
            car.drive_task = asyncio.create_task(
                esp32_client.send_drive(car.steering, car.throttle)
            )

    elif msg_type == "emergency_stop":
        car.emergency_stop = True
        car.throttle       = 0
        print("[EMERGENCY STOP] ACTIVATED — all throttle commands blocked.")
        resp = await esp32_client.send_emergency()
        return {"for": "motor_control", **resp}

    elif msg_type == "reset_emergency_stop":
        car.emergency_stop    = False
        car.fail_safe         = False
        car.last_command_time = time.time()
        print("[EMERGENCY STOP] Reset — commands accepted again.")

    elif msg_type == "arm":
        print("[ARM] Arming motors.")
        resp = await esp32_client.send_arm(True)
        return {"for": "motor_control", **resp}

    elif msg_type == "disarm":
        car.throttle = 0
        print("[DISARM] Disarming motors.")
        resp = await esp32_client.send_arm(False)
        return {"for": "motor_control", **resp}

    elif msg_type == "lap":
        lap_timer.manual_lap()

    elif msg_type == "set_lidar":
        resp = await esp32_client.send_set_lidar(
            int(data.get("stop", 50)),
            int(data.get("slow", 100)),
        )
        return {"for": "lidar_panel", **resp}

    elif msg_type == "set_prox":
        resp = await esp32_client.send_set_prox(
            int(data.get("lv1",  35)),
            int(data.get("lv2",  60)),
            int(data.get("lv3",  85)),
            int(data.get("lv4", 115)),
            int(data.get("close", 10)),
        )
        return {"for": "prox_panel", **resp}

    elif msg_type == "set_mode":
        mode = data.get("mode", "manual")
        await esp32_client.send_mode(mode)

    elif msg_type == "set_auto_version":
        version = data.get("version", "single")
        await esp32_client.send_auto_version(version)

    elif msg_type == "keepalive":
        car.last_command_time = time.time()
        car.fail_safe         = False

    else:
        print(f"[UNKNOWN MSG TYPE] {msg_type}")

# ---------------------------------------------------------------------------
# Telemetry generation (fake / simulated)
# ---------------------------------------------------------------------------

async def _poll_esp32() -> None:
    """Fetch ESP32 data and update shared car state. Does not build a snapshot."""
    esp32_data = await esp32_client.fetch_telemetry()
    if not esp32_data:
        # Simulated fallback
        car.battery_percentage = max(0.0, car.battery_percentage - 0.01)
        car.battery_voltage    = round(6.0 + (car.battery_percentage / 100) * 2.4, 2)
        return

    t = esp32_data.get("telemetry", {})

    def _n(v, default):
        return v if v is not None else default

    battery = t.get("battery", {})
    car.battery_percentage = _n(battery.get("pct"), car.battery_percentage)
    car.battery_voltage    = _n(battery.get("v"),   car.battery_voltage)

    control  = t.get("control", {})
    servo_us = _n(control.get("servoUs"), None)
    esc_us   = _n(control.get("escUs"),   None)
    if servo_us is not None:
        car.steering = esp32_client.servo_us_to_pct(servo_us)
    if esc_us is not None:
        car.throttle = esp32_client.esc_us_to_pct(esc_us)

    system = t.get("system", {})
    mstate = system.get("mstate", "")
    if mstate:
        car.motor_state = mstate
    if mstate == "EMERGENCY" or system.get("emergency", False):
        car.emergency_stop = True
    elif mstate == "DISARMED":
        car.emergency_stop = False

    _on_motor_state_change(mstate or car.motor_state)
    # Store raw sensor blocks for snapshot building
    car._last_esp32_t = t


def _build_snapshot() -> dict:
    """Build a telemetry dict from current car state (no I/O)."""
    t = getattr(car, "_last_esp32_t", {})

    rssi = t.get("wireless", {}).get("rssi", -999) if t else -999
    if rssi >= -60:
        signal_quality = "good"
    elif rssi >= -75:
        signal_quality = "medium"
    else:
        signal_quality = "poor" if t else "good"

    speed = round((car.throttle / 100) * 4.0, 2)
    if not t:
        speed = max(0.0, round(speed + random.uniform(-0.05, 0.05), 2))

    snapshot = {
        "type":               "telemetry",
        "car_id":             "car_1",
        "timestamp":          int(time.time()),
        "speed":              speed,
        "battery_percentage": round(car.battery_percentage, 1),
        "battery_voltage":    car.battery_voltage,
        "current_steering":   car.steering,
        "current_throttle":   car.throttle,
        "signal_quality":     signal_quality,
        "emergency_stop":     car.emergency_stop,
        "fail_safe":          car.fail_safe,
        "mode":               car.mode,
        "motor_state":        car.motor_state,
        "lap_count":          lap_timer.lap_count,
        "last_lap_s":         lap_timer.last_lap,
        "best_lap_s":         lap_timer.best_lap,
    }
    for key in ("sonar", "lidar", "imu", "odometry", "control", "system", "wireless", "limits", "battery"):
        if key in t:
            snapshot[key] = t[key]
    return snapshot


async def generate_telemetry() -> dict:
    """Legacy wrapper used by REST endpoints — polls ESP32 and returns snapshot."""
    check_fail_safe()
    await _poll_esp32()
    snapshot = _build_snapshot()
    save_telemetry(snapshot)
    return snapshot

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

    # Send ESP32 URL so the app can drive directly
    await websocket.send_json({
        "type":      "config",
        "esp32_url": esp32_client.BASE_URL,
        "servo":     esp32_client.servo_config,
        "esc":       esp32_client.esc_config,
    })

    # ESP32 poll runs independently — never blocks the WebSocket push.
    async def esp32_poll_loop() -> None:
        while True:
            try:
                await _poll_esp32()
            except Exception:
                pass
            await asyncio.sleep(0.2)

    # WebSocket push runs at fixed 100 ms regardless of ESP32 speed.
    async def telemetry_loop() -> None:
        last_db = 0.0
        while True:
            try:
                check_fail_safe()
                snapshot = _build_snapshot()
                now = time.time()

                await websocket.send_json(snapshot)
                if now - last_db >= 2.0:
                    save_telemetry(snapshot)
                    last_db = now
            except WebSocketDisconnect:
                break
            except Exception as e:
                print(f"[TELEMETRY ERROR] {type(e).__name__}: {e}")
            await asyncio.sleep(0.1)

    poll_task     = asyncio.create_task(esp32_poll_loop())
    telemetry_task = asyncio.create_task(telemetry_loop())

    try:
        while True:
            raw    = await websocket.receive_text()
            data   = json.loads(raw)
            result = await process_command(data)
            if result:
                await websocket.send_json({"type": "command_response", **result})

    except WebSocketDisconnect:
        print("[WS] App disconnected.")
        car.throttle          = 0
        car.fail_safe         = True
        car.last_command_time = 0.0

    except Exception as e:
        print(f"[WS ERROR] {e}")

    finally:
        poll_task.cancel()
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
