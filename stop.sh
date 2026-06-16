#!/usr/bin/env bash
# RC Car Platform — servisleri durdur

CYAN='\033[0;36m'; GREEN='\033[0;32m'; GRAY='\033[0;90m'; NC='\033[0m'

echo -e "${CYAN}RC Car Platform durduruluyor...${NC}"

# Backend (uvicorn)
if pgrep -f "uvicorn main:app" >/dev/null 2>&1; then
    pkill -f "uvicorn main:app" && echo -e "${GREEN}  Backend durduruldu.${NC}"
fi

# Dashboard (vite)
if pgrep -f "vite" >/dev/null 2>&1; then
    pkill -f "vite" && echo -e "${GREEN}  Dashboard durduruldu.${NC}"
fi

# InfluxDB Docker container
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^rc_influxdb$"; then
    docker stop rc_influxdb >/dev/null && echo -e "${GREEN}  InfluxDB durduruldu.${NC}"
fi

echo -e "${GRAY}Tamamlandi.${NC}"
