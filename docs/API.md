# WaveSpot API

현장 서버(FastAPI) 하나가 REST · WebSocket · 프론트 빌드를 모두 제공합니다. 자동 문서: `http://<서버>:8000/docs`

## REST (`/api`)
| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 서버 확인 |
| GET | `/status` | 시험 · 수신기(`rate` 최근 10초 초당 받은 신호 · `heard` 잡힌 기기 수) · 기준 비콘 · 허용 목록 · 시계 |
| GET | `/scenarios` | 녹화 재생 시나리오 목록 |
| POST | `/session` | 새 시험 `{name, scenario, rows, cols}` (진행 중 시험은 종료) |
| POST | `/session/baseline` | 입실 전 20분 기준선 → 허용 목록 등록 |
| POST | `/session/start` | 감시 시작 |
| POST | `/session/control` | 재생 제어 `{action: "pause" \| "resume", speed}` |
| GET | `/requests` · `/requests/{id}` | 수색 요청 · 근거 카드 (`level` 2 휴대형 접근 · 3 정밀 수색 · 4 2차 수색, `counter` 반대 근거, `suspect_seat`, `walk`) |
| POST | `/requests/{id}/start` | Lv2 · Lv4 는 휴대형 순회 시작 (Lv4 는 안 돈 구역), Lv3 은 정밀 수색 시작 기록 · 선택 본문 `{zones, dwell}` = 감독관이 정한 순회 경로(구역 순서)와 좌석당 머무는 초(1~5) |
| POST | `/allowlist` | 감독관 허용 목록 추가 `{device_id, label}` (감독관 폰 · 시험장 장비) → 조사 종료, 열린 요청은 `allowed`(허용 등록) |
| POST | `/requests/{id}/result` | 결과 `{found, seat, note}` → 발견 = 정답 · 미발견 + 신호 지속 = Lv4 (학습 보류) · Lv4 후 미발견 = 미해결 · 신호 사라짐 = 오탐 학습 |
| GET | `/events?limit=200` | 에이전트 판단 기록 |
| GET | `/devices` | 조사 중인 기기 (관찰 · 주의 · 요청) |
| GET · POST | `/notes` | 감독관 의견 · 메모 목록 / 추가 `{text}` (기록 화면, 사후 검증용) |
| GET | `/faults` | 장애 대응 표(`catalog`) · 이번 교시 장애 · 복구 기록(`records`) · 재현 가능 여부 |
| POST | `/faults/{kind}` | 장애 재현 (관리자 · 재생 모드 · 시험 중) `node1 · node2 · server · model · app · network · beacon · clock · result` |
| GET | `/attacks` | 우회 · 해킹 대응 표(`catalog`: 대응 · 남는 한계 · 구현 상태) · 재현 · 탐지 기록(`runs`: 탐지 시각 · 최고 대응 단계) · 거부한 측정값 수 · 허용 기기 입실 전 세기 패턴 수 · 이번 교시에 바꾼 기준 점수(`thresholds`, 관리자에게만) |
| POST | `/attacks/{kind}` | 우회 · 해킹 재현 (관리자 · 재생 모드 · 시험 중, 설계안 실험 8) `burst · approach_off · spoof · rotate · fake · ap · account` |
| GET | `/chain/verify` | 해시 체인 다시 계산 `{ok, count, last_hash, broken}` · `last_hash` 는 감독관 확인서에 적는 값 |
| GET | `/access` | 접근 기록 (관리자 · 감사만) |
| GET | `/report/export` | 시험 후 리포트 JSON 내려받기 (수색 내역 · 판단 기록 · 의견 · 장애 기록 · 체인 확인 결과) |

설계안 v11 10장 반영:
- `/status` 에 `health`(장비 이상 때 동작 단계 `mode`: normal · degraded(수신기 3/4) · no_location(2대 이상 끊김) · recovering(서버 재시작) · manual(망 장애 = 감시 중단), 비콘 `frozen` = 보정 정지, `model_rule` 규칙 점수 사용 중, `locked` 시험 중 잠금, `checkpoint` 마지막 상태 저장)와 `selfcheck`(수신기 · 비콘 · 시계 동기화 · 저장 공간 · 펌웨어 서명 · 인증서 · AI 모델) 포함
- `/session/start` 는 자가 점검에 실패 항목이 있으면 409
- `/allowlist` 는 시험이 시작되면 423 (허용 목록 잠금, 변경 시도는 접근 기록에 거부로 남음)
- `/requests/{id}/result` 가 503(저장 확인 응답 없음)이거나 서버에 닿지 않으면 앱이 태블릿에 먼저 저장하고 연결되면 자동 전송 ('전송 대기')
- 역할: 요청 머리글 `X-WaveSpot-Role: supervisor | admin | auditor` (기본 감독관). 감사는 열람만(변경 403), 장애 재현은 관리자만. 실기기 단계에서 로그인 · 관리자 2단계 인증으로 교체
- 모든 `/api` 열람 · 변경 · 내보내기는 접근 기록에 남음 (`/status` · `/health` · `/scenarios` · WebSocket 제외)

## WebSocket (`/api/ws`)
서버 → 앱, `{"type": ..., "data": ...}`
| type | data |
|---|---|
| `status` | `/status` 와 같음 (연결 직후 · 상태 변경 시) |
| `clock` | `{t, clock, minute, duration_min, state, paused, speed}` |
| `devices` | 10초 판단 창마다 조사 중 메타기기 목록 (대응 단계 · 구역 1 · 2순위 · 점수 · 기기 연결 보류) |
| `stats` | 모델 호출 수 `{agent_calls, pipeline_calls, windows, device_windows}` |
| `event` | 에이전트 판단 기록 1건 · `data.calls` 부른 모델 · `data.skipped` 건너뛴 모델 · `data.gain/loss` 결정 함수 값 |
| `request` | 정밀 수색 요청 생성 · 변경 |
| `resync` | 앱이 끊겼다 다시 연결됐을 때 놓친 알림 수 `{missed}` (기록은 앱이 다시 받아 옴) |
| `handheld` | 순회 중 `{request_id, zone, pos_seat, pass, rssi, rel_db, level: far \| near \| nearest}` (최고값 대비 -10 · -4 dB 기준) · 끝나면 `{done, best_seat, seat_medians}` |

## MQTT (수신기 → 현장 서버)
ESPresense 토픽 구조를 따름 (`espresense/devices/{device}/{node}` → `wavespot/...`)
| 토픽 | 내용 |
|---|---|
| `wavespot/devices/{device_id}/{node_id}` | `{"rssi": -67, "rssiVar": 4.1, "company": "0x004C", "interval": 30, "wifi": null}` |
| `wavespot/rooms/{node_id}/status` | `online` \| `offline` (retain) |
| `wavespot/handheld/{device_id}/{node_id}` | 휴대형 수신기 측정 (예정) |

- `device_id` 는 수신기에서 MAC 주소를 해시한 값 (원본 주소 미저장) — 회차별 키와 SHA-256, 앞 6바이트 (`firmware/wavespot_receiver`)
- Wi-Fi 기기는 같은 토픽에 `{"rssi": -58, "wifi": true, "wifi_feat": {...12개}}` 를 10초마다 보냄 (특징 이름은 `backend/app/ml/wifi_sim.py` FEATS)
- `node_id` 는 R1 ~ R4 (설치형), H1 ~ (휴대형)
- 서버는 paho 클라이언트를 별도 스레드에서 돌려 받음 → Windows · 리눅스 모두 동작
- 시험 방법: 브로커(Mosquitto 또는 amqtt) 실행 → `WAVESPOT_SOURCE=mqtt` 로 백엔드 실행 → `server/replay/publish_mqtt.py --port <브로커 포트>`
