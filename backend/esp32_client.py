"""
esp32_client.py — All communication between the backend and the ESP32.

The backend initiates every exchange:
  - Sends drive commands (steering + throttle) when the app sends a command
  - Sends emergency stop when triggered
  - Polls the ESP32 for telemetry every 500 ms (called from the telemetry loop)

ESP32 must expose these HTTP endpoints:
  POST /drive      — body: { "steering": int, "throttle": int }
  POST /emergency  — no body required
  GET  /telemetry  — returns sensor snapshot (see fetch_telemetry docstring)

Set the ESP32_IP environment variable to match your ESP32's static IP:
  $env:ESP32_IP = "192.168.1.200"
"""

import os
import httpx

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

ESP32_IP      = os.getenv("ESP32_IP")          # None if not set
ESP32_ENABLED = ESP32_IP is not None           # only attempt comms if IP is configured
BASE_URL      = f"http://{ESP32_IP}" if ESP32_IP else ""
TIMEOUT       = 0.3   # seconds — short so a missing ESP32 doesn't block the loop

# ---------------------------------------------------------------------------
# Drive command
# ---------------------------------------------------------------------------

async def send_drive(steering: int, throttle: int) -> bool:
    """
    Push steering + throttle to the ESP32.
    Called every time the app sends a command.
    Returns True on success, False if ESP32 is unreachable.
    """
    if not ESP32_ENABLED:
        return False
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/drive",
                json={"steering": steering, "throttle": throttle},
                timeout=TIMEOUT,
            )
            return r.status_code == 200
    except Exception as e:
        print(f"[ESP32] send_drive failed: {e}")
        return False

# ---------------------------------------------------------------------------
# Arm / Disarm
# ---------------------------------------------------------------------------

async def send_arm(armed: bool) -> bool:
    """
    Arm or disarm the ESC.
      armed=True  → arm   (enable motor, ready to drive)
      armed=False → disarm (disable motor)
    Called before sending drive commands and when shutting down.
    """
    if not ESP32_ENABLED:
        return False
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/arm",
                json={"armed": armed},
                timeout=TIMEOUT,
            )
            print(f"[ESP32] {'Armed' if armed else 'Disarmed'}")
            return r.status_code == 200
    except Exception as e:
        print(f"[ESP32] send_arm failed: {e}")
        return False

# ---------------------------------------------------------------------------
# Emergency stop
# ---------------------------------------------------------------------------

async def send_emergency() -> bool:
    """
    Tell the ESP32 to cut throttle immediately.
    Called when the app triggers an emergency stop.
    Returns True on success.
    """
    if not ESP32_ENABLED:
        return False
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{BASE_URL}/emergency", timeout=TIMEOUT)
            return r.status_code == 200
    except Exception as e:
        print(f"[ESP32] send_emergency failed: {e}")
        return False

# ---------------------------------------------------------------------------
# Telemetry poll
# ---------------------------------------------------------------------------

async def fetch_telemetry() -> dict | None:
    """
    Ask the ESP32 for its latest sensor snapshot.
    Called every 500 ms from the telemetry loop in main.py.

    Expected JSON response from the ESP32:
    {
        "telemetry": {
            "sonar": {
                "lCm": 45.2,    "rCm": 38.7,    // raw distances (hypotenuse), cm
                "lLv": 2,       "rLv": 1,        // proximity level 0-4
                "lFwd": 32.0,   "lLat": 32.0,    // left forward/lateral projection, cm
                "rFwd": 27.4,   "rLat": 27.4,    // right forward/lateral projection, cm
                "angle": 45.0                     // mounting angle, degrees
            },
            "lidar": {
                "ok": false,    // TF-Luna UART active?
                "cm": -1.0      // forward distance, cm (-1 = error)
            },
            "imu": {
                "ok": true,  "calibrated": true,
                "ax": 0.012, "ay": -0.034, "az": 9.810,   // accel m/s²
                "gx": 0.010, "gy": -0.020, "gz": 0.000,   // gyro deg/s
                "roll": 1.20, "pitch": -0.50, "yaw": 45.30, // degrees
                "temp": 32.1                                // °C
            },
            "odometry": {
                "x": 0.142,     // dead-reckoning position X, m
                "y": -0.037     // dead-reckoning position Y, m
            },
            "control": {
                "steer": 1.23,  "steerPct": 0,  "servoUs": 2500,
                "thrPct": 0,    "escUs": 1500
            },
            "battery": {
                "v": 7.80,      // voltage, V
                "pct": 57       // percentage 0-100
            },
            "system": {
                "mstate": "ARMED",      // "ARMED" | "DISARMED"
                "armPct": 100,          // arming progress %
                "disarmReason": "none",
                "mode": "AUTO",         // "AUTO" | "MANUAL"
                "emergency": false
            },
            "wireless": {
                "wifiOk": true,
                "rssi": -62             // dBm
            },
            "limits": {
                "throttleLimit": 40,
                "autoThrottle": 30
            }
        }
    }

    Returns the parsed dict on success, or None if the ESP32 is
    unreachable (caller falls back to simulated values).
    """
    if not ESP32_ENABLED:
        return None
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{BASE_URL}/telemetry", timeout=TIMEOUT)
            if r.status_code == 200:
                return r.json()
    except Exception:
        pass  # ESP32 not connected yet — silent fallback
    return None
