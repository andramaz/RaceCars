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

from database import save_telemetry, get_race_summary
import esp32_client

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


# One shared instance for the prototype (single-car, single-session).
car = CarState()

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

        # Battery
        battery            = t.get("battery", {})
        battery_percentage = battery.get("pct", car.battery_percentage)
        battery_voltage    = battery.get("v",   car.battery_voltage)
        car.battery_percentage = battery_percentage
        car.battery_voltage    = battery_voltage

        # Speed from odometry (magnitude of X/Y velocity — placeholder until encoder speed added)
        odometry = t.get("odometry", {})
        speed    = round((odometry.get("x", 0.0) ** 2 + odometry.get("y", 0.0) ** 2) ** 0.5, 2)

        # Signal quality from RSSI
        rssi = t.get("wireless", {}).get("rssi", -999)
        if rssi >= -60:
            signal_quality = "good"
        elif rssi >= -75:
            signal_quality = "medium"
        else:
            signal_quality = "poor"

        # Sync emergency and mode from ESP32 system state
        system = t.get("system", {})
        if system.get("emergency", False):
            car.emergency_stop = True

        print("[ESP32] Real telemetry received.")
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
    print("[WS] App connected.")

    # Background task: push telemetry every 500 ms.
    async def telemetry_loop() -> None:
        while True:
            try:
                snapshot = await generate_telemetry()
                await websocket.send_json(snapshot)
                await asyncio.sleep(0.5)
            except Exception:
                break   # WebSocket closed; stop the loop silently.

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
    """Return fake race analytics. Replace with real InfluxDB queries later."""
    return get_race_summary()


@app.get("/")
async def root() -> dict:
    return {"status": "RC Car backend is running", "docs": "/docs"}
