// WaveSpot 수신기 설정 예시
// 이 파일을 같은 폴더에 config.h 로 복사한 뒤 값을 바꾸세요. (config.h 는 .gitignore 로 저장소에 올라가지 않음)
#pragma once

// ---- 수신기 전용 AP (시험장 내부망) ----
#define WS_WIFI_SSID      "WaveSpot-AP"
#define WS_WIFI_PASS      "change-me"

// ---- 현장 서버 MQTT 브로커 (Raspberry Pi · Mosquitto) ----
#define WS_MQTT_HOST      "192.168.4.10"
#define WS_MQTT_PORT      1883
#define WS_TOPIC_ROOT     "wavespot"          // backend 설정 mqtt_topic_root 와 같아야 함

// ---- 이 수신기의 이름 ----
// 설치형: R1(앞 왼쪽) R2(앞 오른쪽) R3(뒤 왼쪽) R4(뒤 오른쪽) · 휴대형: H1, H2 ...
#define WS_NODE_ID        "R1"

// ---- 기기 주소 해시 키 (시험 회차마다 바꾸고, 회차가 끝나면 폐기) ----
// 같은 회차의 수신기 4대 · 휴대형은 반드시 같은 키를 써야 같은 기기가 같은 device_id 로 묶임
#define WS_HASH_KEY       "2026-11-23-room101-session1"

// ---- Wi-Fi 감청 ----
// ESP32 는 AP 에 연결된 상태에서는 그 AP 의 채널만 감청할 수 있음 → 수신기 전용 AP 채널 = 감시할 채널
#define WS_ENABLE_WIFI_SNIFF 1
