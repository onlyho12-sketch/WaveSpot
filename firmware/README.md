# WaveSpot 수신기 펌웨어 (ESP32)

천장 설치형 수신기(R1~R4)와 감독관 휴대형 수신기(H1~)에 올리는 펌웨어입니다.
BLE 광고와 Wi-Fi 데이터 프레임을 **듣기만** 하고(내용은 해독하지 않음), 현장 서버의 MQTT 브로커로 측정값을 보냅니다.
보내는 형식은 `docs/API.md`의 'MQTT' 절과 같아서, 백엔드를 `WAVESPOT_SOURCE=mqtt`로 띄우면 그대로 받습니다.

## 하는 일

| 기능 | 내용 | 백엔드에서 쓰는 곳 |
|---|---|---|
| BLE 수동 스캔 | 기기별 세기 평균 · 흔들림(rssiVar) · 광고 간격(interval) · 제조사 번호(company), 1초마다 송출 (휴대형 0.5초) | 위치 · 교실 안/밖 · 기기 묶기 · 종류 추정 |
| Wi-Fi 감청 | 데이터 프레임의 길이 · 시각 · 방향만 재서 10초마다 특징 12개(`wifi_feat`) 계산 | Wi-Fi 용도 분류 (`app/ml/wifi_sim.py` FEATS와 같은 이름 · 단위) |
| 생존 신호 | `wavespot/rooms/{node}/status` 에 5초마다 `online`, 끊기면 브로커가 `offline`(LWT) | 장비 점검 표 · '수신기 3/4' 전환 |
| 개인정보 | MAC 주소는 회차별 키와 함께 SHA-256 해시 → 앞 6바이트만 `device_id` 로 보냄 | 원본 주소는 저장 · 송출하지 않음 |

토픽 예시

```
wavespot/devices/3fa91c0b2e7d/R1   {"rssi":-67.0,"rssiVar":4.1,"company":"0x004C","interval":104}
wavespot/devices/9b1e44a0c2f1/R1   {"rssi":-58.0,"wifi":true,"wifi_feat":{"up_kbps":980.12,"dn_kbps":1203.50,...}}
wavespot/rooms/R1/status           online   (retain)
wavespot/handheld/3fa91c0b2e7d/H1  {"rssi":-49.0,...}   (휴대형)
```

## 준비물

- ESP32 개발보드 (ESP32-DevKitC 등) — 설치형 4대 + 휴대형 1대
- 수신기 전용 AP (시험장 내부망) · 현장 서버(Raspberry Pi)에서 Mosquitto 실행 (`server/mqtt/mosquitto.conf`)

## 설정

`wavespot_receiver/config.example.h` 를 같은 폴더에 `config.h` 로 복사하고 값을 바꿉니다. `config.h` 는 비밀번호가 들어가므로 저장소에 올리지 않습니다(.gitignore).

| 값 | 설명 |
|---|---|
| `WS_WIFI_SSID` · `WS_WIFI_PASS` | 수신기 전용 AP |
| `WS_MQTT_HOST` · `WS_MQTT_PORT` | 현장 서버 브로커 주소 |
| `WS_NODE_ID` | `R1`~`R4`(설치형, 앞 왼쪽 · 앞 오른쪽 · 뒤 왼쪽 · 뒤 오른쪽), `H1`(휴대형) |
| `WS_HASH_KEY` | 회차별 해시 키. **같은 회차의 수신기는 모두 같은 키**, 회차가 끝나면 폐기 |
| `WS_ENABLE_WIFI_SNIFF` | Wi-Fi 감청 켜기(1) / 끄기(0) |

## 빌드 · 업로드

**PlatformIO** (권장, 라이브러리 버전 고정)

```
cd firmware
pio run -e receiver -t upload     # 설치형 (WS_NODE_ID 를 R1~R4 로 바꿔 4번)
pio run -e handheld -t upload     # 휴대형
pio device monitor                # 115200
```

**Arduino IDE**

1. 보드 매니저에서 `esp32` (Espressif, 2.0.x 권장) 설치, 보드는 ESP32 Dev Module, Partition Scheme은 Huge APP
2. 라이브러리 매니저에서 `NimBLE-Arduino` 1.4.x, `PubSubClient` 2.8 설치
3. `wavespot_receiver/wavespot_receiver.ino` 를 열고 업로드 (휴대형은 파일 맨 위에 `#define WS_ROLE_HANDHELD 1` 추가)

## 연결 확인 순서

1. 현장 서버: `mosquitto -c server/mqtt/mosquitto.conf -v`
2. 수신기 전원 → 시리얼 모니터에 `[wifi] ... 채널 N`, `[mqtt] 연결`
3. `mosquitto_sub -t 'wavespot/#' -v` 로 측정값이 1초마다 오는지 확인
4. 백엔드: `WAVESPOT_SOURCE=mqtt` 로 실행 → 앱 **준비** 탭 장비 점검 표에서 R1~R4 '양호'

## 알려진 한계 (실측으로 확인할 것)

- **Wi-Fi 채널**: ESP32는 AP에 연결된 동안 그 AP의 채널만 감청합니다. 수신기 전용 AP의 채널을 감시할 채널(예: 1 · 6 · 11)에 맞추거나, 채널을 돌며 듣는 전용 수신기를 따로 두어야 합니다.
- **BLE와 Wi-Fi 동시 사용**: 무선을 나눠 쓰므로 스캔 창을 70% 로 줄였습니다. 광고를 놓친 만큼 `interval` 은 '이번 주기 최소 간격'의 평균으로 추정합니다.
- **클래식 블루투스**(이어폰 소리 전송)는 들을 수 없습니다 → 차폐 파우치 절차로 보완 (설계안 3 · 19장).
- **Wi-Fi 특징 근사**: 프레임 간격 중앙값(`iat_med`)은 로그 히스토그램으로 근사합니다. 용도 분류 모델은 근거 기반 모의 데이터로 학습되어 있으므로, 실측(설계안 20장 실험 4) 후 다시 학습해야 합니다.
- **입실 전 기준선**: 백엔드 MQTT 모드에는 아직 기준선 수집 구간이 없습니다 (저장소 README '현재 한계').
- 이 펌웨어는 빌드 확인용 헤더로 문법 검사만 했고, 실제 보드에서의 동작은 아직 확인하지 않았습니다.

## 라이선스

| 구성 | 라이선스 |
|---|---|
| NimBLE-Arduino | Apache-2.0 |
| PubSubClient | MIT |
| Arduino-ESP32 core | LGPL-2.1 |
| mbedTLS (ESP32 core 포함) | Apache-2.0 |

MQTT 토픽 구조는 ESPresense(AGPL-3.0)를 참고했지만 코드는 가져오지 않고 직접 작성했습니다.
