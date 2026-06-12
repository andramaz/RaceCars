# RC Car Platform — API & Data Exchange Document
**Department 3 → shared with Department 1 & Department 2**

---

## Overview

Department 3 runs a FastAPI backend that acts as the central hub between:
- The mobile app / web dashboard (Dept 3)
- The RC car hardware / ESP32 (Dept 1)
- The autonomous control algorithms (Dept 2)

All communication uses **JSON over WebSocket** (real-time) or **JSON over HTTP** (REST).

---

## 1. WebSocket Endpoint

**URL:** `ws://<PC_IP>:8000/ws`

This is the main real-time channel. The mobile app and dashboard connect here.

### 1.1 Commands — App → Backend

The app sends JSON messages to the backend over this WebSocket.

#### Drive Command
```json
{
  "type": "command",
  "steering": 45,
  "throttle": 60,
  "mode": "manual",
  "timestamp": 1718000000
}
```
| Field | Type | Range | Description |
|---|---|---|---|
| type | string | `"command"` | Message type |
| steering | int | -100 to +100 | Negative = left, Positive = right |
| throttle | int | 0 to 100 | 0 = stop, 100 = full speed |
| mode | string | `"manual"` / `"autonomous"` | Drive mode |
| timestamp | int | Unix timestamp | Time of command |

#### Emergency Stop
```json
{
  "type": "emergency_stop",
  "timestamp": 1718000000
}
```

#### Reset Emergency Stop
```json
{
  "type": "reset_emergency_stop",
  "timestamp": 1718000000
}
```

---

### 1.2 Telemetry — Backend → App/Dashboard

The backend sends a telemetry snapshot every **500ms** to all connected clients.

```json
{
  "type": "telemetry",
  "car_id": "car_1",
  "timestamp": 1718000000,
  "speed": 3.2,
  "battery_percentage": 85.0,
  "battery_voltage": 7.88,
  "current_steering": 45,
  "current_throttle": 60,
  "signal_quality": "good",
  "emergency_stop": false,
  "fail_safe": false,
  "mode": "manual"
}
```

| Field | Type | Description |
|---|---|---|
| type | string | Always `"telemetry"` |
| car_id | string | Identifier for the car |
| timestamp | int | Unix timestamp |
| speed | float | Current speed in m/s |
| battery_percentage | float | Battery level 0-100% |
| battery_voltage | float | Battery voltage in Volts |
| current_steering | int | Active steering value (-100 to +100) |
| current_throttle | int | Active throttle value (0-100) |
| signal_quality | string | `"good"` / `"medium"` / `"poor"` |
| emergency_stop | bool | True if emergency stop is active |
| fail_safe | bool | True if no command received for >1s |
| mode | string | `"manual"` or `"autonomous"` |

---

## 2. REST Endpoints

**Base URL:** `http://<PC_IP>:8000`

### GET /
Health check.
```json
{ "status": "RC Car backend is running", "docs": "/docs" }
```

### GET /api/race-summary
Returns post-race analytics.
```json
{
  "lap_times": [12.4, 12.1, 11.9, 12.3, 11.7],
  "top_speed": 3.8,
  "average_speed": 2.6,
  "sensor_error_rate": 1.8,
  "packet_count": 542,
  "speed_series": [{ "time": 0, "speed": 0.5 }, "..."],
  "battery_series": [{ "time": 0, "battery": 100.0 }, "..."]
}
```

---

## 3. ESP32 Interface (Dept 1 must implement)

The backend will send drive commands to the ESP32 via HTTP POST.

**ESP32 must expose:**

### POST /command
```json
{
  "steering": 45,
  "throttle": 60
}
```
Expected response:
```json
{ "status": "ok" }
```

**ESP32 must also send back sensor data to the backend:**

### POST http://<PC_IP>:8000/telemetry (from ESP32)
```json
{
  "speed": 3.2,
  "battery_voltage": 7.88,
  "battery_percentage": 85.0,
  "imu": {
    "ax": 0.1,
    "ay": 0.0,
    "az": 9.8,
    "gx": 0.01,
    "gy": 0.00,
    "gz": 0.02
  },
  "gps": {
    "lat": 48.8566,
    "lng": 2.3522
  }
}
```

| Field | Type | Description |
|---|---|---|
| speed | float | Speed in m/s (from encoder or GPS) |
| battery_voltage | float | Raw voltage from voltage divider |
| battery_percentage | float | Calculated battery level |
| imu.ax/ay/az | float | Accelerometer (m/s²) |
| imu.gx/gy/gz | float | Gyroscope (rad/s) |
| gps.lat/lng | float | GPS coordinates |

---

## 4. Autonomous Mode Interface (Dept 2)

When mode is set to `"autonomous"`, the backend expects commands from Dept 2's algorithm instead of the app joystick.

**Dept 2 connects to the same WebSocket:** `ws://<PC_IP>:8000/ws`

And sends the same drive command format:
```json
{
  "type": "command",
  "steering": 20,
  "throttle": 40,
  "mode": "autonomous",
  "timestamp": 1718000000
}
```

---

## 5. Safety Rules (all departments must respect)

- If no command is received for **>1 second** → fail-safe activates, throttle forced to 0
- Emergency stop overrides all commands until explicitly reset
- Steering range: **-100 to +100** (never outside this range)
- Throttle range: **0 to 100** (never negative)

---

## 6. Network Setup

```
PC (Backend)  ←→  Phone/Dashboard (Dept 3)   via ws://<PC_IP>:8000/ws
PC (Backend)  ←→  ESP32 (Dept 1)             via http://<ESP32_IP>/command
PC (Backend)  ←→  Autonomous algo (Dept 2)   via ws://<PC_IP>:8000/ws
```

All devices must be on the **same Wi-Fi network**.

Recommended: give the ESP32 a **static IP address** so it doesn't change between sessions.

---

*Generated by Department 3 — RC Car Control Platform*
