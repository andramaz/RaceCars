"""
main.py — FastAPI backend for the RC Car Control Platform.

Responsibilities:
  - Accept WebSocket connections from the React Native app
  - Receive steering / throttle / emergency-stop commands
  - Send fake telemetry every 500 ms
  - Implement fail-safe logic (throttle = 0 if no command for >1 s)
  - Simulate forwarding commands to the ESP32 onboard controller
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


def process_command(data: dict) -> None:
    """Parse and apply one incoming command message from the app."""
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
        forward_command_to_esp32(car.steering, car.throttle)

    elif msg_type == "emergency_stop":
        car.emergency_stop = True
        car.throttle       = 0
        print("[EMERGENCY STOP] ACTIVATED — all throttle commands blocked.")
        forward_command_to_esp32(car.steering, 0)

    elif msg_type == "reset_emergency_stop":
        car.emergency_stop    = False
        car.fail_safe         = False
        car.last_command_time = time.time()   # reset the fail-safe timer too
        print("[EMERGENCY STOP] Reset — commands accepted again.")

    else:
        print(f"[UNKNOWN MSG TYPE] {msg_type}")

# ---------------------------------------------------------------------------
# Simulated ESP32 forwarding
# ---------------------------------------------------------------------------

def forward_command_to_esp32(steering: int, throttle: int) -> None:
    """
    Simulate forwarding a drive command to the ESP32 onboard controller.

    The ESP32 receives steering (-100…+100) and throttle (0…100), maps them
    to PWM duty cycles, and drives the steering servo and ESC/motor.

    TODO (hardware): Replace this function body with a real outbound call once
    the ESP32 firmware is ready.  Options (pick one):

        Option A — HTTP POST (simplest for ESP32 Arduino/MicroPython):
            import httpx
            async with httpx.AsyncClient() as client:
                await client.post(
                    "http://<ESP32_IP>/command",
                    json={"steering": steering, "throttle": throttle},
                    timeout=0.3,
                )

        Option B — MQTT (good for low-latency broadcast):
            mqtt_client.publish(
                "rc_car/command",
                json.dumps({"steering": steering, "throttle": throttle}),
            )

        Option C — WebSocket to ESP32:
            await esp32_ws.send(
                json.dumps({"steering": steering, "throttle": throttle})
            )

    Network topology reminder:
        PC hotspot  ←→  ESP32 (Wi-Fi client, static IP recommended)
        PC hotspot  ←→  Phone (Wi-Fi client)
        Phone connects to FastAPI at  ws://<PC_IP>:8000/ws
        FastAPI connects to ESP32 at  http://<ESP32_IP>/command  (or MQTT)
    """
    print(f"[→ ESP32] steering={steering:+d}  throttle={throttle}")

# ---------------------------------------------------------------------------
# Telemetry generation (fake / simulated)
# ---------------------------------------------------------------------------

def generate_telemetry() -> dict:
    """
    Build a telemetry snapshot based on the current car state.
    All values are simulated; replace with real sensor reads later.
    """
    check_fail_safe()

    # Speed roughly proportional to throttle with a small random jitter.
    speed = max(0.0, round((car.throttle / 100) * 4.0 + random.uniform(-0.05, 0.05), 2))

    # Slowly drain battery (0.01 % per 500 ms tick ≈ 1.2 % per minute).
    car.battery_percentage = max(0.0, car.battery_percentage - 0.01)
    car.battery_voltage    = round(6.0 + (car.battery_percentage / 100) * 2.4, 2)

    # Simulate signal quality with weighted random noise.
    roll = random.random()
    if roll > 0.90:
        signal_quality = "poor"
    elif roll > 0.65:
        signal_quality = "medium"
    else:
        signal_quality = "good"

    telemetry = {
        "type":              "telemetry",
        "car_id":            "car_1",
        "timestamp":         int(time.time()),
        "speed":             speed,
        "battery_percentage": round(car.battery_percentage, 1),
        "battery_voltage":   car.battery_voltage,
        "current_steering":  car.steering,
        "current_throttle":  car.throttle,
        "signal_quality":    signal_quality,
        "emergency_stop":    car.emergency_stop,
        "fail_safe":         car.fail_safe,
        "mode":              car.mode,
    }

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
                snapshot = generate_telemetry()
                await websocket.send_json(snapshot)
                await asyncio.sleep(0.5)
            except Exception:
                break   # WebSocket closed; stop the loop silently.

    telemetry_task = asyncio.create_task(telemetry_loop())

    try:
        while True:
            raw  = await websocket.receive_text()
            data = json.loads(raw)
            process_command(data)

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
