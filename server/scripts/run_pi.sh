#!/usr/bin/env bash
# 현장 서버 (Raspberry Pi 4) 실행: 브로커 + 백엔드(프론트 빌드 포함 제공)
# 감독관 태블릿 · 휴대폰은 수신기 전용 AP에 접속해 http://<Pi IP>:8000 으로 접속
set -e
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mosquitto -c "$ROOT/server/mqtt/mosquitto.conf" -d
cd "$ROOT/backend"
WAVESPOT_SOURCE="${WAVESPOT_SOURCE:-mqtt}" .venv/bin/fastapi run app/main.py --host 0.0.0.0 --port 8000
