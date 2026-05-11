"""
database.py — Telemetry storage module.

Currently uses in-memory storage (prototype mode).

To add InfluxDB later:
  1. pip install influxdb-client
  2. Set these environment variables:
       INFLUXDB_URL    = "http://localhost:8086"
       INFLUXDB_TOKEN  = "<your-token>"
       INFLUXDB_ORG    = "<your-org>"
       INFLUXDB_BUCKET = "rc_car"
  3. Replace the placeholder implementations below with real InfluxDB write/query calls.
"""

from typing import Any

# --- In-memory buffer (prototype only) ---
_telemetry_buffer: list[dict] = []
MAX_BUFFER_SIZE = 1000


def save_telemetry(data: dict[str, Any]) -> None:
    """
    Persist one telemetry snapshot.

    TODO (InfluxDB): create a Point like:
        point = (
            Point("telemetry")
            .tag("car_id", data["car_id"])
            .field("speed",              data["speed"])
            .field("battery_percentage", data["battery_percentage"])
            .field("battery_voltage",    data["battery_voltage"])
            .field("current_steering",   data["current_steering"])
            .field("current_throttle",   data["current_throttle"])
            .field("emergency_stop",     data["emergency_stop"])
            .field("fail_safe",          data["fail_safe"])
            .time(data["timestamp"], WritePrecision.S)
        )
        write_api.write(bucket=BUCKET, org=ORG, record=point)
    """
    _telemetry_buffer.append(data)
    if len(_telemetry_buffer) > MAX_BUFFER_SIZE:
        _telemetry_buffer.pop(0)


def get_race_summary() -> dict[str, Any]:
    """
    Return high-level race statistics.

    TODO (InfluxDB): replace fake data with Flux queries such as:
        max(speed), mean(speed), count(telemetry records),
        battery drain series, and lap-trigger event series.
    """
    packet_count = len(_telemetry_buffer) if _telemetry_buffer else 542

    return {
        "lap_times":         [12.4, 12.1, 11.9, 12.3, 11.7],
        "top_speed":         3.8,
        "average_speed":     2.6,
        "sensor_error_rate": 1.8,
        "packet_count":      packet_count,
        "speed_series":      get_speed_series(),
        "battery_series":    get_battery_series(),
    }


def get_speed_series(start_time: int | None = None,
                     end_time:   int | None = None) -> list[dict]:
    """
    Return speed samples over time.

    TODO (InfluxDB):
        from(bucket: BUCKET)
          |> range(start: start_time, stop: end_time)
          |> filter(fn: (r) => r._measurement == "telemetry" and r._field == "speed")
          |> aggregateWindow(every: 1s, fn: mean)
    """
    return [{"time": i, "speed": round(0.5 + i * 0.18 + (i % 3) * 0.07, 2)} for i in range(20)]


def get_battery_series(start_time: int | None = None,
                       end_time:   int | None = None) -> list[dict]:
    """
    Return battery-percentage samples over time.

    TODO (InfluxDB):
        from(bucket: BUCKET)
          |> range(start: start_time, stop: end_time)
          |> filter(fn: (r) => r._measurement == "telemetry" and r._field == "battery_percentage")
          |> aggregateWindow(every: 1s, fn: mean)
    """
    return [{"time": i, "battery": round(100 - i * 0.35, 1)} for i in range(20)]
