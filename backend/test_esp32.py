"""
ESP32 bağlantı testi — terminalde çalıştır:
    venv\Scripts\python.exe test_esp32.py
"""
import asyncio
import httpx

import socket
HOST = input("ESP32 host/IP (Enter = esp.local): ").strip() or "esp.local"

# Hostname'i IP'ye çevir
try:
    IP = socket.gethostbyname(HOST)
    print(f"Çözümlendi: {HOST} → {IP}")
except Exception as e:
    IP = HOST
    print(f"DNS çözümlenemedi, direkt kullanılıyor: {HOST} ({e})")

BASE = f"http://{IP}:5000"

async def test():
    print(f"\nBağlanıyor: {BASE}/status ...")
    try:
        async with httpx.AsyncClient() as c:
            r = await c.get(f"{BASE}/status", timeout=3.0)
            print(f"HTTP {r.status_code}")
            data = r.json()
            t = data.get("telemetry", {})
            sys = t.get("system", {})
            print(f"mstate     : {sys.get('mstate', 'YOK')}")
            print(f"emergency  : {sys.get('emergency', 'YOK')}")
            print(f"mode       : {sys.get('mode', 'YOK')}")
            battery = t.get("battery", {})
            print(f"battery    : {battery.get('v')}V  {battery.get('pct')}%")
            wireless = t.get("wireless", {})
            print(f"rssi       : {wireless.get('rssi')} dBm")
            print("\nBAGLANTI BASARILI")
    except Exception as e:
        print(f"HATA TÜRÜ : {type(e).__name__}")
        print(f"HATA DETAY: {e}")
        import traceback
        traceback.print_exc()

asyncio.run(test())
