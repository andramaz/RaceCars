"""
database.py — Telemetry storage.

Live data  → in-memory ring buffer  (real-time dashboard, unchanged)
Historical → InfluxDB 2.x           (History tab, post-race analysis)

InfluxDB one-time setup:
  1. winget install InfluxData.influxdb   (or influxdata.com/downloads)
  2. influxd                              (starts server on :8086)
  3. http://localhost:8086 → quick-start
       • Create organisation  e.g. "rc_car_org"
       • Create bucket        e.g. "rc_car"
       • Copy the generated API token
  4. Set env vars before running the backend (start.ps1 prompts for them):
       $env:INFLUXDB_TOKEN  = "<paste token here>"
       $env:INFLUXDB_ORG    = "rc_car_org"
       $env:INFLUXDB_BUCKET = "rc_car"
"""

import os
import time
import uuid
from typing import Any

# ── In-memory buffer (live dashboard — unchanged) ──────────────────────────
_telemetry_buffer: list[dict] = []
MAX_BUFFER_SIZE = 1000

# ── InfluxDB config ────────────────────────────────────────────────────────
INFLUX_URL    = os.getenv("INFLUXDB_URL",    "http://localhost:8086")
INFLUX_TOKEN  = os.getenv("INFLUXDB_TOKEN",  "")
INFLUX_ORG    = os.getenv("INFLUXDB_ORG",    "rc_car_org")
INFLUX_BUCKET = os.getenv("INFLUXDB_BUCKET", "rc_car")

_write_api     = None
_query_api     = None
INFLUX_ENABLED = False


def _init_influx() -> None:
    global _write_api, _query_api, INFLUX_ENABLED
    if not INFLUX_TOKEN:
        print("[DB] INFLUXDB_TOKEN not set — history tab disabled (live dashboard OK).")
        return
    try:
        from influxdb_client import InfluxDBClient
        from influxdb_client.client.write_api import SYNCHRONOUS
        client     = InfluxDBClient(url=INFLUX_URL, token=INFLUX_TOKEN, org=INFLUX_ORG)
        _write_api = client.write_api(write_options=SYNCHRONOUS)
        _query_api = client.query_api()
        INFLUX_ENABLED = True
        print(f"[DB] InfluxDB enabled → {INFLUX_URL}  org={INFLUX_ORG}  bucket={INFLUX_BUCKET}")
    except ImportError:
        print("[DB] influxdb-client not installed — run: pip install influxdb-client")
    except Exception as e:
        print(f"[DB] InfluxDB init failed: {e}")


_init_influx()

# ── Session tracking ───────────────────────────────────────────────────────
_current_session_id: str = ""
_session_active: bool = False   # True only while ARMED (InfluxDB writes enabled)


def new_session() -> str:
    """Called on WebSocket connect — resets in-memory buffer ID only."""
    global _current_session_id
    _current_session_id = ""    # cleared; will be set by arm_session()
    return ""


def current_session() -> str:
    return _current_session_id


def arm_session(car_id: str = "car_1") -> str:
    """
    Start a new InfluxDB session.  Call when motor state transitions → ARMED.
    If a session is already active (e.g. wall-recovery re-arm), keep the
    existing session ID so the run appears as one continuous session.
    """
    global _current_session_id, _session_active
    if _session_active:
        print(f"[DB] Session resumed (wall re-arm): {_current_session_id}")
        return _current_session_id
    _current_session_id = f"s_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    _session_active = True
    print(f"[DB] Session ARMED — started: {_current_session_id}")
    return _current_session_id


def end_session() -> None:
    """
    End the current InfluxDB session.  Call when:
      - Motor transitions ARMED → DISARMED (immediate)
      - Motor is in EMERGENCY and grace period (60 s) expires without re-arm
    """
    global _current_session_id, _session_active
    if not _session_active:
        return
    print(f"[DB] Session ended: {_current_session_id}")
    _session_active = False
    # Keep _current_session_id so the last telemetry point can still reference it;
    # next arm_session() call will create a fresh ID.


# ── Sensor error helper ────────────────────────────────────────────────────

def _has_sensor_error(data: dict) -> bool:
    """Return True if any sensor reported a fault in this telemetry packet."""
    lidar = data.get("lidar", {})
    imu   = data.get("imu",   {})
    lidar_err = lidar and lidar.get("ok") is False
    imu_err   = imu   and imu.get("ok")   is False
    return bool(lidar_err or imu_err)


def _sensor_error_rate(buffer: list[dict]) -> float:
    """Calculate % of packets with a sensor fault from a telemetry buffer."""
    packets_with_sensors = [t for t in buffer if t.get("lidar") or t.get("imu")]
    if not packets_with_sensors:
        return 0.0
    errors = sum(1 for t in packets_with_sensors if _has_sensor_error(t))
    return round(errors / len(packets_with_sensors) * 100, 1)


# ── Write ──────────────────────────────────────────────────────────────────

def save_telemetry(data: dict[str, Any]) -> None:
    """Persist one telemetry snapshot to in-memory buffer + InfluxDB (if configured)."""
    # ── In-memory (live dashboard) — always ───────────────────────────────
    _telemetry_buffer.append(data)
    if len(_telemetry_buffer) > MAX_BUFFER_SIZE:
        _telemetry_buffer.pop(0)

    # ── InfluxDB (history tab) — only when ARMED session is active ───────
    if not INFLUX_ENABLED or not _session_active or not _current_session_id:
        return
    try:
        from influxdb_client import Point, WritePrecision
        point = (
            Point("telemetry")
            .tag("car_id",     data.get("car_id",     "car_1"))
            .tag("session_id", _current_session_id)
            .field("speed",              float(data.get("speed",              0)))
            .field("battery_percentage", float(data.get("battery_percentage", 0)))
            .field("battery_voltage",    float(data.get("battery_voltage",    0)))
            .field("current_steering",   int(  data.get("current_steering",   0)))
            .field("current_throttle",   int(  data.get("current_throttle",   0)))
            .field("motor_state",        str(  data.get("motor_state",        "UNKNOWN")))
            .field("emergency_stop",     bool( data.get("emergency_stop",     False)))
            .field("sensor_error",       bool(_has_sensor_error(data)))
            .time(data["timestamp"], WritePrecision.S)
        )
        _write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point)
    except Exception as e:
        print(f"[DB] InfluxDB write error: {e}")


# ── Query — session list ───────────────────────────────────────────────────

def get_sessions(limit: int = 20) -> list[dict]:
    """
    Return list of past sessions from InfluxDB (newest first).
    Each entry: { session_id, car_id, start_time (ISO-8601), start_ts (unix) }
    Returns [] when InfluxDB is not configured.
    """
    if not INFLUX_ENABLED:
        return []
    try:
        flux = f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "telemetry" and r._field == "speed")
  |> keep(columns: ["session_id", "car_id", "_time", "_value"])
  |> group(columns: ["session_id"])
  |> first()
  |> group()
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: {limit})
'''
        tables   = _query_api.query(flux, org=INFLUX_ORG)
        sessions = []
        for table in tables:
            for record in table.records:
                t = record.get_time()
                sessions.append({
                    "session_id": record.values.get("session_id", ""),
                    "car_id":     record.values.get("car_id",     "car_1"),
                    "start_time": t.isoformat() if t else "",
                    "start_ts":   int(t.timestamp()) if t else 0,
                })
        return sessions
    except Exception as e:
        print(f"[DB] get_sessions error: {e}")
        return []


# ── Query — single session ─────────────────────────────────────────────────

def get_session_data(session_id: str) -> dict:
    """
    Return speed, battery, and steering series + aggregate stats for one session.
    Returns {"error": ..., "influx_enabled": False} when InfluxDB is not configured.
    """
    if not INFLUX_ENABLED:
        return {"error": "InfluxDB not configured", "influx_enabled": False}
    try:
        flux = f'''
from(bucket: "{INFLUX_BUCKET}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "telemetry")
  |> filter(fn: (r) => r.session_id == "{session_id}")
  |> filter(fn: (r) =>
      r._field == "speed" or
      r._field == "battery_percentage" or
      r._field == "current_steering" or
      r._field == "sensor_error")
  |> sort(columns: ["_time"])
'''
        tables          = _query_api.query(flux, org=INFLUX_ORG)
        speed_series    = []
        battery_series  = []
        steering_series = []
        speeds          = []
        sensor_errors   = 0
        sensor_total    = 0

        for table in tables:
            for record in table.records:
                field = record.get_field()
                value = record.get_value()
                ts    = int(record.get_time().timestamp())

                if field == "speed":
                    speed_series.append({"time": ts, "speed": round(float(value), 2)})
                    speeds.append(float(value))
                elif field == "battery_percentage":
                    battery_series.append({"time": ts, "battery": round(float(value), 1)})
                elif field == "current_steering":
                    steering_series.append({"time": ts, "steering": int(value)})
                elif field == "sensor_error":
                    sensor_total += 1
                    if value:
                        sensor_errors += 1

        duration = (
            (speed_series[-1]["time"] - speed_series[0]["time"])
            if len(speed_series) >= 2 else 0
        )

        return {
            "session_id":      session_id,
            "speed_series":    speed_series,
            "battery_series":  battery_series,
            "steering_series": steering_series,
            "stats": {
                "top_speed":         round(max(speeds),              2) if speeds else 0,
                "average_speed":     round(sum(speeds) / len(speeds), 2) if speeds else 0,
                "data_points":       len(speeds),
                "duration_s":        duration,
                "sensor_error_rate": round(sensor_errors / sensor_total * 100, 1) if sensor_total else 0,
            },
        }
    except Exception as e:
        print(f"[DB] get_session_data error: {e}")
        return {"error": str(e)}


# ── Legacy helper (used by /api/race-summary) ──────────────────────────────

def get_race_summary() -> dict[str, Any]:
    packet_count = len(_telemetry_buffer)
    speeds       = [t["speed"] for t in _telemetry_buffer if "speed" in t]
    recent       = _telemetry_buffer[-20:] if _telemetry_buffer else []
    return {
        "lap_times":         [],
        "top_speed":         round(max(speeds),              2) if speeds else 0,
        "average_speed":     round(sum(speeds) / len(speeds), 2) if speeds else 0,
        "sensor_error_rate": _sensor_error_rate(_telemetry_buffer),
        "packet_count":      packet_count,
        "speed_series":      [{"time": i, "speed": t["speed"]}              for i, t in enumerate(recent)],
        "battery_series":    [{"time": i, "battery": t["battery_percentage"]} for i, t in enumerate(recent)],
    }
