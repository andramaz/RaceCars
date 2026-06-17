"""
esp32_client.py - All communication between the backend and the ESP32.

The backend initiates every exchange:
  - Sends drive commands (steering + throttle) when the app sends a command
  - Sends emergency stop when triggered
  - Polls the ESP32 for telemetry every 500 ms (called from the telemetry loop)

ESP32 endpoints (http://esp.local:5000 or http://<IP>:5000):
  POST /control?steer=<us>&thr=<us>  - drive command
  POST /arm                           - arm motor (DISARMED -> ARMED)
  POST /disarm                        - disarm motor
  POST /estop                         - emergency stop (-> EMERGENCY state)
  GET  /status                        - full telemetry snapshot

Set ESP32_HOST env var to the ESP32's IP for reliable connections on Windows:
  $env:ESP32_HOST = "192.168.1.200"
  (start.ps1 does this automatically via Resolve-DnsName / ping)
"""

import asyncio
import os
import socket as _socket
import httpx

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_raw_host = os.getenv("ESP32_HOST", "esp.local")

def _resolve_host(hostname: str) -> str:
    """Resolve hostname to IP. Returns IP string, or original hostname on failure."""
    try:
        ip = _socket.gethostbyname(hostname)
        if ip != hostname:
            print(f"[ESP32] Resolved {hostname} -> {ip}")
        return ip
    except Exception as e:
        print(f"[ESP32] Could not resolve '{hostname}': {e}")
        return hostname

if _raw_host:
    ESP32_HOST = _resolve_host(_raw_host)
else:
    ESP32_HOST = ""

BASE_URL = f"http://{ESP32_HOST}:5000" if ESP32_HOST else ""

def _refresh_host() -> None:
    """Re-resolve hostname → IP after a connection failure. Updates BASE_URL."""
    global ESP32_HOST, BASE_URL
    if not _raw_host:
        return
    new_ip = _resolve_host(_raw_host)
    if new_ip != ESP32_HOST:
        print(f"[ESP32] Host updated: {ESP32_HOST} -> {new_ip}")
        ESP32_HOST = new_ip
        BASE_URL   = f"http://{ESP32_HOST}:5000"
DRIVE_TIMEOUT  = 0.3   # fire-and-forget — just needs to reach ESP32
STATUS_TIMEOUT = 1.0   # needs a full response back

# Connection backoff — only retry every 0.2 s after a failure
import time as _time
_next_attempt: float = 0.0
RETRY_INTERVAL = 0.2

# Persistent HTTP client — reused across calls to avoid TCP handshake overhead
_http_client: httpx.AsyncClient | None = None

def _client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient()
    return _http_client

def _reset_client() -> None:
    """Discard the current HTTP client so next call creates a fresh one."""
    global _http_client
    _http_client = None

# Live config — updated from ESP32 /status response (config.servo / config.esc).
# Defaults match the ESP32 firmware defaults until first /status is received.
servo_config: dict = {"minUs": 1700, "neutralUs": 2000, "maxUs": 2300}
esc_config:   dict = {"minUs": 1370, "neutralUs": 1470, "maxUs": 1600}

def _steering_to_us(pct: int) -> int:
    """Convert steering percentage (-100..+100) to servo µs using live config."""
    mid = servo_config["neutralUs"]
    if pct >= 0:
        return int(mid + (pct / 100) * (servo_config["maxUs"] - mid))
    else:
        return int(mid + (pct / 100) * (mid - servo_config["minUs"]))

def servo_us_to_pct(servo_us: int) -> int:
    """Convert raw servo µs back to steering percentage (-100..+100)."""
    mid = servo_config["neutralUs"]
    if servo_us >= mid:
        span = servo_config["maxUs"] - mid
        return round((servo_us - mid) / span * 100) if span else 0
    else:
        span = mid - servo_config["minUs"]
        return round((servo_us - mid) / span * 100) if span else 0

def esc_us_to_pct(esc_us: int) -> int:
    """Convert raw ESC µs to throttle percentage (-100..+100). Negative = reverse."""
    mid = esc_config["neutralUs"]
    if esc_us >= mid:
        span = esc_config["maxUs"] - mid
        return max(0, min(100, round((esc_us - mid) / span * 100))) if span else 0
    else:
        span = mid - esc_config["minUs"]
        return max(-100, min(0, round((esc_us - mid) / span * 100))) if span else 0

def _throttle_to_us(pct: int) -> int:
    """Convert throttle percentage (-100..+100) to ESC µs. Negative = reverse."""
    mid = esc_config["neutralUs"]
    if pct >= 0:
        return int(mid + (pct / 100) * (esc_config["maxUs"] - mid))
    else:
        return int(mid + (pct / 100) * (mid - esc_config["minUs"]))

# ---------------------------------------------------------------------------
# Drive command
# ---------------------------------------------------------------------------

async def send_drive(steering: int, throttle: int) -> bool:
    """
    Push steering + throttle to the ESP32 via POST /control.
    Converts percentage values to us before sending.
    Only works when ESP32 is ARMED.
    """
    if not BASE_URL:
        return False
    steer_us = _steering_to_us(steering)
    thr_us   = _throttle_to_us(throttle)
    try:
        r = await _client().post(
            f"{BASE_URL}/control",
            params={"steer": steer_us, "thr": thr_us},
            timeout=DRIVE_TIMEOUT,
        )
        return r.status_code == 200
    except Exception as e:
        print(f"[ESP32] send_drive failed: {e}")
        _reset_client()
        _refresh_host()
        return False

# ---------------------------------------------------------------------------
# Arm / Disarm
# ---------------------------------------------------------------------------

async def send_arm(armed: bool) -> bool:
    """
    Arm (armed=True) or disarm (armed=False) the motor.
    Retries up to 3 times with 400 ms between attempts.
    """
    if not BASE_URL:
        return False
    endpoint = "/arm" if armed else "/disarm"
    label    = "ARM" if armed else "DISARM"
    for attempt in range(1, 4):
        try:
            r = await _client().post(f"{BASE_URL}{endpoint}", timeout=DRIVE_TIMEOUT)
            if r.status_code == 200:
                print(f"[ESP32] {label} OK (attempt {attempt})")
                return True
            print(f"[ESP32] {label} attempt {attempt} → HTTP {r.status_code}")
        except Exception as e:
            print(f"[ESP32] {label} attempt {attempt} failed: {type(e).__name__}: {e}")
        await asyncio.sleep(0.4)
    print(f"[ESP32] {label} failed after 3 attempts")
    return False

# ---------------------------------------------------------------------------
# Mode / Auto-version
# ---------------------------------------------------------------------------

async def send_mode(mode: str) -> bool:
    """Switch ESP32 between 'auto' and 'manual' run mode."""
    if not BASE_URL:
        return False
    try:
        r = await _client().post(f"{BASE_URL}/mode", params={"mode": mode}, timeout=DRIVE_TIMEOUT)
        print(f"[ESP32] Mode → {mode}: HTTP {r.status_code}")
        return r.status_code == 200
    except Exception as e:
        print(f"[ESP32] send_mode failed: {e}")
        return False

async def send_auto_version(version: str) -> bool:
    """Switch autonomous mode between 'single' and 'multi' car."""
    if not BASE_URL:
        return False
    try:
        r = await _client().post(f"{BASE_URL}/auto-version", params={"version": version}, timeout=DRIVE_TIMEOUT)
        print(f"[ESP32] Auto-version → {version}: HTTP {r.status_code}")
        return r.status_code == 200
    except Exception as e:
        print(f"[ESP32] send_auto_version failed: {e}")
        return False

# ---------------------------------------------------------------------------
# Emergency stop
# ---------------------------------------------------------------------------

async def send_emergency() -> bool:
    """
    Send emergency stop to ESP32 via POST /estop.
    Moves ESP32 to EMERGENCY state. Requires /disarm to recover.
    """
    if not BASE_URL:
        return False
    try:
        r = await _client().post(f"{BASE_URL}/estop", timeout=DRIVE_TIMEOUT)
        return r.status_code == 200
    except Exception as e:
        print(f"[ESP32] send_emergency failed: {e}")
        return False

# ---------------------------------------------------------------------------
# Telemetry poll
# ---------------------------------------------------------------------------

async def fetch_telemetry() -> dict | None:
    """
    Poll ESP32 for latest sensor snapshot via GET /status.
    Called every 500 ms from the telemetry loop in main.py.

    Response format from ESP32:
    {
        "config": {
            "servo": { "minUs": 1700, "neutralUs": 2000, "maxUs": 2300 },
            "esc":   { "minUs": 1370, "neutralUs": 1470, "maxUs": 1600 }
        },
        "telemetry": {
            "sonar":    { "lCm", "rCm", "lLv", "rLv", "lFwd", "lLat", "rFwd", "rLat", "angle" },
            "lidar":    { "ok", "cm" },
            "imu":      { "ok", "calibrated", "ax", "ay", "az", "gx", "gy", "gz", "roll", "pitch", "yaw", "temp" },
            "odometry": { "x", "y" },
            "control":  { "steer", "steerPct", "servoUs", "thrPct", "escUs" },
            "battery":  { "v", "pct" },
            "system":   { "mstate", "armPct", "disarmReason", "mode", "emergency" },
            "wireless": { "wifiOk", "rssi" },
            "limits":   { "throttleLimit", "autoThrottle" }
        }
    }

    Returns the parsed dict on success, None if ESP32 unreachable.
    """
    if not BASE_URL:
        return None
    global _next_attempt
    now = _time.time()
    if now < _next_attempt:
        return None
    try:
        r = await _client().get(f"{BASE_URL}/status", timeout=STATUS_TIMEOUT)
        if r.status_code == 200:
            _next_attempt = 0
            data = r.json()
            # Sync live servo/esc config from ESP32
            cfg = data.get("config", {})
            if cfg.get("servo"):
                servo_config.update(cfg["servo"])
            if cfg.get("esc"):
                esc_config.update(cfg["esc"])
            return data
    except Exception:
        _next_attempt = _time.time() + RETRY_INTERVAL
        _reset_client()
        _refresh_host()
    return None
