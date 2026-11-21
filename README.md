# WaveSpot 감독관 앱

무선 신호로 시험장에 숨은 기기가 있는지 먼저 판단하고, 있을 때만 정밀 수색 근거를 주는 플랫폼의 프로토타입.
설계안 v10 · 판단 순서 **신호 감지 → 위치 추정 → 수색** · 수색 강화 사다리 **Lv0 감시 → Lv1 관찰 → Lv2 휴대형 접근 → Lv3 정밀 수색 → Lv4 2차 수색**
2026 대한민국 청년 CAREER FAIR AI 해커톤 · 팀 DAUP

> 녹화 재생(데모 모드)의 수신기 세기 · 휴대형 세기 · Wi-Fi 프레임은 **근거 기반 모의 데이터**입니다 (실측 아님).
> 공개 데이터에서 적합한 값과 논문 · 표준 수치로만 만들었고, 감독관 화면에는 표시하지 않고 기획서와 관리 탭(데이터 출처)에 표기합니다. 실측(설계안 20장 실험 3 · 4)으로 교체 예정.

## 실행
**필요한 것**: Python 3.11 이상 · Node.js 20 이상. **따로 받을 데이터는 없습니다** (모델은 설치 단계에서 모의 데이터로 바로 학습, DB 는 처음 실행할 때 자동 생성).

처음 한 번 (Windows PowerShell, 이 폴더에서) · 약 2~3분
```
powershell -ExecutionPolicy Bypass -File server/scripts/setup.ps1
```
개발 실행 → http://localhost:5173 (같은 와이파이 태블릿 · 휴대폰은 `http://<PC IP>:5173`)
```
powershell -ExecutionPolicy Bypass -File server/scripts/dev.ps1
```
한 서버로 실행 (프론트 빌드 포함, 현장 방식) → http://localhost:8000
```
cd frontend; npm run build; cd ../backend; .venv/Scripts/fastapi run app/main.py
```
macOS · Linux (처음 한 번 + 실행) → http://localhost:8000
```
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m app.ml.train_models
cd ../frontend && npm install && npm run build
cd ../backend && .venv/bin/fastapi run app/main.py
```
앱을 열면 **준비** 탭에서 기준선 만들기 → 시험 전 확인 체크 → 감시 시작. 시연 시나리오가 재생되며 녹화 재생 속도(1 · 10 · 30 · 60배)는 준비 탭에서 바꿉니다.
모델 3개(위치 8구역 · 교실 안/밖 · Wi-Fi 용도)는 `backend/app/ml/train_models.py` 가 모의 데이터로 약 15초 만에 학습합니다 (외부 데이터 불필요, setup.ps1 에 포함).
교실 40석 데이터는 설계안 v10 에 따라 내부 참고 검증에만 쓰고 모델 학습에는 쓰지 않습니다.

| 모의 데이터 | 파라미터 · 출처 |
|---|---|
| 설치형 · 휴대형 세기 (`app/ml/sim.py`) | 1 m -74.3 dBm · n 1.67 · σ 5.8 dB (공개 학교 BLE, Mendeley CC BY 4.0 적합) · 인체 차폐 10~20 dB 50% (Leith & Farrell 2020) |
| Wi-Fi 프레임 (`app/ml/wifi_sim.py`) | 영상 통화 (MacMillan et al. IMC 2021) · WebRTC 1,200 B · 음성 Opus 50 pps (webrtcHacks) · 사진 크기 사례 · 대기 (Huang et al. IMC 2012) |

| 모델 (모의 학습 · 처음 보는 위치 · 세션 평가) | 정확도 |
|---|---|
| 5석 구역 · 10초 창 1개 → 30초 누적 → 60초 누적 | 29% → 45% → 51% (1 · 2순위 안 56% → 71% → 76%) |
| 교실 안 / 밖 | 90% |
| Wi-Fi 용도 4종 · 10초 창 | 97% |

## 모듈 구성
| 폴더 | 역할 | 스택 |
|---|---|---|
| `frontend/` | 감독관 앱 · 감독(좌석 지도 · 상태 · 근거 카드) · 순회(휴대형 세기 · 결과 입력) · 기록 · 준비 | React 19 · Vite · TypeScript · Tailwind v4 · Radix(shadcn/ui 방식) · TanStack Router/Query |
| `backend/app/api` | REST · WebSocket | FastAPI |
| `backend/app/agent` | AI 에이전트 · 수색 강화 사다리 · 기다림의 가치 vs 놓칠 위험 결정 · 반대 근거 · 미발견 처리 규칙 · 기기 묶기(메타기기) · 모델 호출 기록 | Python |
| `backend/app/ml` | 위치 8구역 · 교실 안/밖 · Wi-Fi 용도 랜덤 포레스트, 근거 기반 모의 데이터 생성 · 학습 | scikit-learn |
| `backend/app/services` | 10초 창 집계 · 녹화 재생 · MQTT 입력 · 엔진 | aiomqtt |
| `db/` | SQLite 스키마 | SQLModel |
| `server/` | Mosquitto 설정 · MQTT 재생 송출 · 실행 스크립트 (Windows · 라즈베리파이) | |
| `docs/` | API · WebSocket · MQTT 메시지 형식 | |

## 화면 기준
- 태블릿 가로(840px 이상)를 기준으로 두 칸 배치, 태블릿 세로 · 휴대폰(360px~)은 한 줄로 쌓고 아래 탭 사용
- 폭 구분은 Material 3 window size class (600 · 840 · 1200px)
- 글꼴은 Pretendard 하나 (숫자는 고정폭 숫자로 줄 맞춤) · 패키지로 번들 → 시험장 내부망에서 외부 인터넷 없이 동작
- 디자인: 업무용 도구 톤 · 색은 남색 회색 계열 · 태블릿 가로 = 왼쪽 내비 레일 + 위쪽 장비 상태 줄 + 시스템 배너(장비 고장 · 연결 끊김)
  - 감독: 왼쪽 어두운 감독실(상태별 카운터 장비 · 신호 · 요청 + 좌석 배치도 + 교시 상태 타임라인, 구역 머리에 '관찰 중 · 3분 지속' 상태 문구) · 오른쪽 'AI 감지' 패널(위험 점수 원형 배지 40~69 주황 / 70+ 빨강 + 제목 + 근거 2줄 + 버튼 2개, 없으면 '이상 없음' 한 장)
  - 근거 서랍: 오른쪽에서 겹쳐 열림(Kismet) · 사다리 진행 단계(Atlassian) · 70점 기준선(Datadog) · 수색 후 할 일 번호 안내(Android 추적기 알림)
  - 순회: 배경 전체 색 전환(Apple 정밀 탐색) + 원형 게이지(Wunderfind) · 상태는 모양 + 색 + 글자(IBM Carbon)
  - 기록 = 시험 후 리포트: 종합 소견 3단(수색 요청 / 관찰 / 이상 없음, 기기 기준) + 처리 결과 · 트랙별 타임라인 · 수색 내역 표(구역 · 감지 기기 · 점수 · 처리 결과 · 근거 / 신호 기록 보기) · 감독관 의견(사후 검증 기록) · 필터 로그
  - 준비: 장비 점검 표(수신기별 받은 신호 건/초 · 들리는 기기 수 + 양호 / 주의 / 끊김, 실제로 받은 값만) · 시험 시작 전 확인(휴대폰 수거 · 차폐 파우치)을 다 체크해야 감시 시작
  - 휴대폰(600px 미만): 순회 중에는 화면 전체를 쓰는 정밀 탐색(Apple 나의 찾기 배치, 방향 화살표 대신 최고값 대비 게이지 + 3단계 색 + 진동), 순회 후 결과 버튼은 아래 고정
  - 관리 탭(심사 · 관리자용): 기기별 판단 흐름 신호 감지 → 위치 추정 → 수색(Datadog 가설 트리) · 사용한 모델 / 건너뛴 모델 · 더 지켜볼지 판단(얻는 확신 vs 놓칠 위험) · 추적 기기 필터(전체 · 관찰 중 · 수색 요청 · 허용 목록) · 에이전트 vs 파이프라인 모델 호출 · 실시간 판단 기록 · 추적 기기 표 · 장비 · 데이터 출처. 감독 화면에는 '에이전트 작동 중' 한 줄만
  - 감독: 구역 ⋮ 메뉴(휴대형 접근 · 근거 보기 · 결과 입력 · 허용 목록 추가) · 근거 서랍은 신호원별 탭(천장 수신기 · 휴대형 · Wi-Fi)
  - 순회 전: 순회 경로 설정(구역 순서 · 좌석마다 머무는 시간 1~5초, 권장 2초) · 순회 중 지금 구역 / 다음 구역 표시
  - 내비: 시험 당일 흐름 순서(시험 전 준비 → 시험 중 감독 · 순회 → 시험 후 기록) + 위쪽 줄에 지금 단계 · 기록 중 표시
  - 문구 원칙: 감독관이 할 일만 표시 · 위험 점수는 AI 감지 카드 배지 하나만, 확률 · 모델 출처 · dBm · 모델 호출 수는 화면에서 뺌 (근거 서랍 · 기록 '전체'에서만 일부)

## 참고한 것
- [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template): `api/routes` · `core` · `models` 분리, React + Tailwind + shadcn/ui + TanStack 조합
- [ESPresense](https://github.com/ESPresense/ESPresense) · [ESPresense-companion](https://github.com/ESPresense/ESPresense-companion): ESP32 BLE 수신기 → MQTT 토픽 구조(`devices/{device}/{node}`, `rooms/{node}/status`), 위치 판단 과정을 단계별로 설명하는 DeviceExplanation → 근거 카드 · 조사 기록
- [Material 3 window size classes](https://m3.material.io/foundations/layout/applying-layout/window-size-classes): 태블릿 · 휴대폰 배치 기준
- [shadcn/ui](https://ui.shadcn.com): 버튼(cva) · 시트(Radix Dialog) 구성 방식
- [Bermuda](https://github.com/agittins/bermuda): 실제 기기 1대 = 메타기기, 바뀌어 온 주소 = 출처 목록(최신이 앞), 출처 수명 16분(`PRUNE_TIME_KNOWN_IRK`) → `agent/linking.py`.
  Bermuda 는 IRK 로 확정하지만 시험장의 모르는 기기는 키가 없어, 설계안 v10 검증 ⑧ 대로 제조사 · 광고 간격 · 수신기 4대 세기 유사도로 잇고 1 · 2위 차이 0.2 미만이면 보류

## 시연 시나리오 (`demo`, 설계안 v10 상황 ①~⑦)
| 상황 | 앱에서 보이는 것 |
|---|---|
| ① 정상 · ③ 주소만 바뀐 감독관 폰 | 허용 기기와 같은 기기로 연결 → 조사 종료 (묶기만 호출) |
| ② 옆 교실 스마트워치 | 교실 밖 판정 → 종료 (묶기 · 안/밖만 호출) |
| ④ 숨긴 이어폰 27번 (10분마다 주소 변경) | Lv1 관찰(얻는 것 > 잃는 것) → Lv3 정밀 수색 → 휴대형 순회로 27번 |
| ⑤ 숨긴 휴대폰 14번 영상 통화 | 용도 모델 먼저 → 영상 통화 → 확신이 낮아도 Lv2 즉시 → Lv3 |
| 미발견인데 신호 지속 | Lv4 2차 수색 · 안 돈 구역 휴대형 재접근 · 학습 보류, 다시 미발견이면 ‘미해결’ |
| ⑦ 수신기 R3 꺼짐 (09:55~09:57) | 화면 경고 · 위치는 규칙 예비 → 복구 후 AI 로 복귀 |
| `quiet` 부정행위자 없는 교시 | 100분 동안 요청 0회 · 주의 0회 · 모델 호출 81% 절감 (demo 는 약 67%) |

## 현재 한계 (프로토타입)
- 위치 · 휴대형 · Wi-Fi 는 근거 기반 모의 데이터 학습 → 우리 교실 기준점 10곳 · 팀 기기 · 용도 재현 실측으로 교체
- 기기 종류는 BLE만일 때 광고 간격 규칙 (Wi-Fi 가 있으면 신호 조합으로 대체), 이상 감지 모델은 앱에 아직 미연결
- 기기 묶기는 유사도 + 보류 규칙 (v10 ⑧ 의 학습 모델로 교체 예정)
- MQTT 실제 수신기 경로: 재생 데이터를 브로커로 보내 수신 → 판단 → 요청까지 확인 (Windows · 테스트 브로커 amqtt).
  단, **MQTT 모드의 입실 전 기준선은 아직 없음** (재생 모드만) → 실기기 연결 시 기준선 수집 구간 구현 필요
- 휴대형 순회는 재생 모드에서만 모의 세기로 동작, 실기기 휴대형(`wavespot/handheld/...`) 수신은 예정
