# RC Car Platform - Tek tikla basla
# Calistirmak icin: powershell -ExecutionPolicy Bypass -File start.ps1

$ROOT = "c:\Users\andrei\Desktop\caps"

# Aktif ag arayuzunun IP'sini otomatik bul
$socket = New-Object System.Net.Sockets.UdpClient
$socket.Connect("8.8.8.8", 80)
$IP = $socket.Client.LocalEndPoint.Address.ToString()
$socket.Close()

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  RC Car Platform" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  PC IP     : $IP" -ForegroundColor Green
Write-Host "  Backend   : http://$IP`:8000" -ForegroundColor Green
Write-Host "  Dashboard  : http://localhost:5173" -ForegroundColor Green
Write-Host "  Controller : http://localhost:8000/controller" -ForegroundColor Green
Write-Host "  App WS URL: ws://$IP`:8000/ws" -ForegroundColor Yellow
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# --- ESP32 IP otomatik tespiti ---
$ESP32_IP = ""

# Yontem 1: DNS cozumlemesi (Resolve-DnsName)
Write-Host "ESP32 aranıyor (esp.local)..." -ForegroundColor Yellow -NoNewline
try {
    $dnsResult = Resolve-DnsName "esp.local" -Type A -ErrorAction Stop
    $ESP32_IP = ($dnsResult | Select-Object -First 1).IPAddress
    if ($ESP32_IP) {
        Write-Host " Bulundu: $ESP32_IP" -ForegroundColor Green
    }
} catch {
    Write-Host " DNS basarisiz." -ForegroundColor DarkGray
}

# Yontem 2: Ping ciktisından IP parse et
if (-not $ESP32_IP) {
    Write-Host "Ping ile deneniyor..." -ForegroundColor Yellow -NoNewline
    $pingOutput = & ping -n 1 esp.local 2>$null
    $match = $pingOutput | Select-String -Pattern "\[(\d+\.\d+\.\d+\.\d+)\]"
    if ($match) {
        $ESP32_IP = $match.Matches[0].Groups[1].Value
        Write-Host " Bulundu: $ESP32_IP" -ForegroundColor Green
    } else {
        Write-Host " Bulunamadi." -ForegroundColor DarkGray
    }
}

# Yontem 3: Manuel giris
if (-not $ESP32_IP) {
    Write-Host "ESP32 IP'sini manuel gir (bilmiyorsan Enter'a bas): " -ForegroundColor Yellow -NoNewline
    $manual = Read-Host
    if ($manual -ne "") {
        $ESP32_IP = $manual
    }
}

# Sonucu goster
if ($ESP32_IP) {
    Write-Host "  ESP32 HOST: $ESP32_IP" -ForegroundColor Green
} else {
    Write-Host "  ESP32: baglanti yok (simulasyon modu)" -ForegroundColor DarkGray
}

Write-Host ""

# --- InfluxDB token (History tab icin) ---
$INFLUX_TOKEN  = "fdjuFn3D8ShgVz2GqdU4A_9xs2L9NfnXkXIPlmvHGvbmdMfOvhnd0EbALpfvil3nLG1QfbIpARPMABbgtRpJtQ=="
$INFLUX_ORG    = if ($env:INFLUXDB_ORG)    { $env:INFLUXDB_ORG    } else { "rc_car_org" }
$INFLUX_BUCKET = if ($env:INFLUXDB_BUCKET) { $env:INFLUXDB_BUCKET } else { "rc_car" }

if ($INFLUX_TOKEN) {
    Write-Host "  InfluxDB  : token set (History tab aktif)" -ForegroundColor Green
} else {
    Write-Host "  InfluxDB  : token yok (History tab pasif - sadece live)" -ForegroundColor DarkGray
}
Write-Host ""

# --- Servisleri basla ---

# InfluxDB
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "Write-Host 'INFLUXDB STARTING...' -ForegroundColor Cyan; & 'C:\Users\andrei\AppData\Local\Microsoft\WinGet\Packages\InfluxData.InfluxDB.OSS_Microsoft.Winget.Source_8wekyb3d8bbwe\influxd.exe'"

Start-Sleep -Seconds 3

# Backend (ESP32_IP + InfluxDB env var'lariyla)
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "`$env:ESP32_HOST='$ESP32_IP'; `$env:INFLUXDB_TOKEN='$INFLUX_TOKEN'; `$env:INFLUXDB_ORG='$INFLUX_ORG'; `$env:INFLUXDB_BUCKET='$INFLUX_BUCKET'; cd '$ROOT\backend'; Write-Host 'BACKEND STARTING...' -ForegroundColor Cyan; venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

Start-Sleep -Seconds 2

# Dashboard
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$ROOT\dashboard'; Write-Host 'DASHBOARD STARTING...' -ForegroundColor Cyan; npm run dev"

Start-Sleep -Seconds 2

# Expo
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$ROOT\RCCarApp'; Write-Host 'EXPO STARTING...' -ForegroundColor Cyan; npx expo start"

Write-Host "Tum servisler baslatildi!" -ForegroundColor Green
Write-Host "App'te WebSocket URL: ws://$IP`:8000/ws" -ForegroundColor Yellow
Write-Host ""
