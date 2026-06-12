# RC Car Platform - Tek tıkla başlat
# Çalıştırmak için: powershell -ExecutionPolicy Bypass -File start.ps1

$ROOT = "c:\Users\andrei\Desktop\caps"

# Aktif ağ arayüzünün IP'sini otomatik bul
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
Write-Host "  Dashboard : http://localhost:5173" -ForegroundColor Green
Write-Host "  App WS URL: ws://$IP`:8000/ws" -ForegroundColor Yellow
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Backend
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$ROOT\backend'; Write-Host 'BACKEND STARTING...' -ForegroundColor Cyan; venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

Start-Sleep -Seconds 2

# Dashboard
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$ROOT\dashboard'; Write-Host 'DASHBOARD STARTING...' -ForegroundColor Cyan; npm run dev"

Start-Sleep -Seconds 2

# Expo
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$ROOT\RCCarApp'; Write-Host 'EXPO STARTING...' -ForegroundColor Cyan; npx expo start"

Write-Host "Tüm servisler başlatıldı!" -ForegroundColor Green
Write-Host "App'te WebSocket URL olarak şunu gir: ws://$IP`:8000/ws" -ForegroundColor Yellow
Write-Host ""
