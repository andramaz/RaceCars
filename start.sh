#!/usr/bin/env bash
# RC Car Platform — macOS launcher
# Calistirmak icin: bash start.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── Renk kodlari ─────────────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
GRAY='\033[0;90m'; RED='\033[0;31m'; NC='\033[0m'

# ── PC IP (aktif ag arayzunun IP'si) ─────────────────────────────────────
IP=$(python3 -c "
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.connect(('8.8.8.8', 80))
print(s.getsockname()[0])
s.close()
" 2>/dev/null || echo "127.0.0.1")

echo ""
echo -e "${CYAN}======================================${NC}"
echo -e "${CYAN}  RC Car Platform${NC}"
echo -e "${CYAN}======================================${NC}"
echo -e "${GREEN}  PC IP      : $IP${NC}"
echo -e "${GREEN}  Backend    : http://$IP:8000${NC}"
echo -e "${GREEN}  Dashboard  : http://localhost:5173${NC}"
echo -e "${GREEN}  Controller : http://$IP:8000/controller${NC}"
echo -e "${YELLOW}  App WS URL : ws://$IP:8000/ws${NC}"
echo -e "${CYAN}======================================${NC}"
echo ""

# ── ESP32 IP tespiti ──────────────────────────────────────────────────────
ESP32_IP=""

# Yontem 1: mDNS (macOS dns-sd / ping)
echo -ne "${YELLOW}ESP32 aranıyor (esp.local)...${NC}"
if RESOLVED=$(python3 -c "import socket; print(socket.gethostbyname('esp.local'))" 2>/dev/null); then
    ESP32_IP="$RESOLVED"
    echo -e " ${GREEN}Bulundu: $ESP32_IP${NC}"
fi

# Yontem 2: arp (MAC adresine gore)
if [ -z "$ESP32_IP" ]; then
    echo -ne "${YELLOW}ARP ile deneniyor (dc:b4:d9:*)...${NC}"
    ARP_RESULT=$(arp -a 2>/dev/null | grep -i "dc:b4:d9" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
    if [ -n "$ARP_RESULT" ]; then
        ESP32_IP="$ARP_RESULT"
        echo -e " ${GREEN}Bulundu: $ESP32_IP${NC}"
    else
        echo -e " ${GRAY}Bulunamadi.${NC}"
    fi
fi

# Yontem 3: Manuel giris
if [ -z "$ESP32_IP" ]; then
    echo -ne "${YELLOW}ESP32 IP'sini manuel gir (bilmiyorsan Enter): ${NC}"
    read -r MANUAL
    [ -n "$MANUAL" ] && ESP32_IP="$MANUAL"
fi

if [ -n "$ESP32_IP" ]; then
    echo -e "${GREEN}  ESP32 HOST: $ESP32_IP${NC}"
else
    echo -e "${GRAY}  ESP32: baglanti yok (simulasyon modu)${NC}"
fi

# ── InfluxDB config ───────────────────────────────────────────────────────
INFLUX_TOKEN="${INFLUXDB_TOKEN:-fdjuFn3D8ShgVz2GqdU4A_9xs2L9NfnXkXIPlmvHGvbmdMfOvhnd0EbALpfvil3nLG1QfbIpARPMABbgtRpJtQ==}"
INFLUX_ORG="${INFLUXDB_ORG:-rc_car_org}"
INFLUX_BUCKET="${INFLUXDB_BUCKET:-rc_car}"
INFLUX_PORT=8086
INFLUX_CONTAINER="rc_influxdb"

echo ""

# ── Docker / InfluxDB ─────────────────────────────────────────────────────
INFLUX_RUNNING=false

if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    echo -e "${YELLOW}InfluxDB baslatiliyor (Docker)...${NC}"

    # Container zaten varsa kaldir (stale state'i onlemek icin)
    if docker ps -a --format '{{.Names}}' | grep -q "^${INFLUX_CONTAINER}$"; then
        if docker ps --format '{{.Names}}' | grep -q "^${INFLUX_CONTAINER}$"; then
            echo -e "${GRAY}  InfluxDB container zaten calisiyor.${NC}"
            INFLUX_RUNNING=true
        else
            echo -e "${GRAY}  Eski container siliniyor...${NC}"
            docker rm "$INFLUX_CONTAINER" >/dev/null 2>&1 || true
        fi
    fi

    if [ "$INFLUX_RUNNING" = false ]; then
        docker run -d \
            --name "$INFLUX_CONTAINER" \
            -p "${INFLUX_PORT}:8086" \
            -e DOCKER_INFLUXDB_INIT_MODE=setup \
            -e DOCKER_INFLUXDB_INIT_USERNAME=admin \
            -e DOCKER_INFLUXDB_INIT_PASSWORD=adminadmin \
            -e DOCKER_INFLUXDB_INIT_ORG="$INFLUX_ORG" \
            -e DOCKER_INFLUXDB_INIT_BUCKET="$INFLUX_BUCKET" \
            -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN="$INFLUX_TOKEN" \
            influxdb:2 >/dev/null

        echo -ne "${GRAY}  InfluxDB hazir olana kadar bekleniyor"
        for i in $(seq 1 15); do
            sleep 1
            echo -ne "."
            if curl -sf "http://localhost:${INFLUX_PORT}/health" >/dev/null 2>&1; then
                break
            fi
        done
        echo -e " ${GREEN}OK${NC}"
        INFLUX_RUNNING=true
    fi

    echo -e "${GREEN}  InfluxDB  : http://localhost:${INFLUX_PORT} (History tab aktif)${NC}"
else
    echo -e "${GRAY}  Docker bulunamadi — InfluxDB atlanıyor (History tab pasif)${NC}"
fi

echo ""

# ── Backend sanal ortam kontrolu ──────────────────────────────────────────
BACKEND_DIR="$ROOT/backend"
VENV_DIR="$BACKEND_DIR/venv"

# venv yoksa olustur
if [ ! -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}Backend venv olusturuluyor...${NC}"
    python3 -m venv "$VENV_DIR"
fi

PYTHON="$VENV_DIR/bin/python"
PIP="$VENV_DIR/bin/pip"

# Gerekli paketler kurulu mu kontrol et
if ! "$PYTHON" -c "import fastapi, uvicorn, httpx" 2>/dev/null; then
    echo -e "${YELLOW}Backend bagımlılıkları kuruluyor...${NC}"
    "$PIP" install -r "$BACKEND_DIR/requirements.txt" -q
fi

# ── Yeni terminal penceresi acan yardimci fonksiyon ───────────────────────
open_term() {
    local title="$1"
    local cmd="$2"
    osascript -e "
        tell application \"Terminal\"
            activate
            set w to do script \"echo -e '\\\\033[1;36m=== $title ===\\\\033[0m'; $cmd\"
            set custom title of front window to \"$title\"
        end tell
    " >/dev/null 2>&1 || {
        # Fallback: iTerm2
        osascript -e "
            tell application \"iTerm2\"
                tell current window
                    create tab with default profile
                    tell current session
                        write text \"echo -e '\\\\033[1;36m=== $title ===\\\\033[0m'; $cmd\"
                    end tell
                end tell
            end tell
        " >/dev/null 2>&1 || {
            # Son fallback: arka plan
            echo -e "${GRAY}  $title arka planda baslatiliyor...${NC}"
            eval "$cmd" &
        }
    }
}

# ── Backend ───────────────────────────────────────────────────────────────
BACKEND_CMD="cd '$BACKEND_DIR'"
BACKEND_CMD+=" && ESP32_HOST='${ESP32_IP}'"
BACKEND_CMD+=" INFLUXDB_TOKEN='${INFLUX_TOKEN}'"
BACKEND_CMD+=" INFLUXDB_ORG='${INFLUX_ORG}'"
BACKEND_CMD+=" INFLUXDB_BUCKET='${INFLUX_BUCKET}'"
BACKEND_CMD+=" '$PYTHON' -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
open_term "RC Backend :8000" "$BACKEND_CMD"
sleep 2

# ── Dashboard ─────────────────────────────────────────────────────────────
DASHBOARD_DIR="$ROOT/dashboard"
if [ ! -d "$DASHBOARD_DIR/node_modules" ]; then
    echo -e "${YELLOW}Dashboard npm paketleri kuruluyor...${NC}"
    (cd "$DASHBOARD_DIR" && npm install -q)
fi
open_term "RC Dashboard :5173" "cd '$DASHBOARD_DIR' && npm run dev"

# ── Ozet ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}Tum servisler baslatildi!${NC}"
echo ""
echo -e "  Dashboard  : ${CYAN}http://localhost:5173${NC}  (Control tab'inda joystick)"
echo -e "  Controller : ${CYAN}http://$IP:8000/controller${NC}  (standalone joystick)"
echo -e "  Backend    : ${CYAN}http://$IP:8000${NC}"
[ "$INFLUX_RUNNING" = true ] && echo -e "  InfluxDB   : ${CYAN}http://localhost:${INFLUX_PORT}${NC}  (admin / adminadmin)"
echo ""
echo -e "${YELLOW}Durdurmak icin: bash stop.sh  (veya terminal pencerelerini kapat + docker stop $INFLUX_CONTAINER)${NC}"
echo ""
