<div align="center">

<img src="docs/images/logo.png" width="560" alt="WaveSpot · 공정한 시험을 돕는 AI 감독 에이전트 시스템"/>

### 시험장에 숨긴 무선 기기를 신호로 먼저 찾는 AI 감독 에이전트

평소에는 조용히 지켜보고, 의심될 때만 **어디를 · 왜 · 어떻게** 수색할지 근거와 함께 감독관에게 알려 줍니다.

2026 대한민국 청년 CAREER FAIR AI 해커톤 · 팀 DAUP · 공모 주제 「AI 에이전트로 푸는 청년의 일·생활 문제」

**[▶ 설치 없이 바로 실행 · wavespot-daup.vercel.app](https://wavespot-daup.vercel.app)**

<br/>

<img src="docs/images/hero.png" width="92%" alt="WaveSpot 감독관 앱 · 태블릿과 휴대폰 화면"/>

</div>

<br/>

## 바로 실행

<table>
  <tr>
    <td width="72%">

| 항목 | 내용 |
|---|---|
| **링크** | **https://wavespot-daup.vercel.app** · 설치 · API 키 없음 |
| **로그인** | 시연용 계정 3개 · 누르면 자동 입력 |
| **첫 화면까지** | 처음 20초 안팎 · 다시 열면 10초 남짓 |
| **권장 화면** | 태블릿 가로 · PC 브라우저 · 휴대폰 |
| **데이터** | 공개 데이터 · 논문 수치로 만든 모의 데이터 (실측 아님) |

</td>
    <td width="28%" align="center"><img src="docs/images/qr_wavespot.png" width="180" alt="wavespot-daup.vercel.app QR 코드"/><br/><sub>휴대폰 카메라로 찍으면 바로 열림</sub></td>
  </tr>
</table>

웹 시연판은 현장 서버 코드(FastAPI · AI 에이전트 · 모델 6개)를 브라우저 안(Pyodide)에서 그대로 실행합니다. 첫 화면까지 걸리는 시간은 이것을 내려받는 시간이며, 실제 시험장에서는 서버가 미리 켜져 있어 기다림이 없습니다. 시험은 30배속으로 재생되어 40분 시험이 2~3분 만에 끝납니다. 새로고침하면 새 시험으로 다시 시작하고, 로그아웃 후 다른 계정으로 들어가면 같은 시험을 이어서 볼 수 있습니다.

<br/>

## 로그인과 역할

계정마다 볼 수 있는 화면과 할 수 있는 일이 다르며, 권한은 서버에서도 같은 기준으로 막습니다 (권한 밖 요청은 403).

비밀번호는 세 계정 모두 **`wavespot2026`** 입니다.

| 역할 | 보이는 화면 | 할 수 있는 일 |
|---|---|---|
| **감독관**<br/>`supervisor` | 준비 · 감독 · 순회 · 기록 | 교실에서 시험 진행. 순회, 수색 결과 입력, 감독관 의견 작성 |
| **관리자**<br/>`admin` | 준비 · 감독(보기만) · 기록 · 관리 | 시험장 시스템과 장비 담당. 설정, 장애와 공격 모의 훈련 (시험 중 기준값은 잠김) |
| **검토자**<br/>`auditor` | 기록 · 관리 | 시험 후 이의 제기와 판정을 검토하는 제3자. 열람만 가능 |

서버에는 비밀번호 대신 PBKDF2 해시만 두고, 로그인하면 서명된 토큰(HMAC-SHA256, 12시간)을 받습니다.

<br/>

## 직접 눌러 보는 순서 (약 5분)

1. 로그인 화면에서 **감독관**을 누르고 **로그인**
2. **준비** 탭: 자가 점검 '모두 통과' 확인 → **허용 기기 등록** → 시험 전 확인 2개 체크 → **감지 시작**
3. **감독** 탭: 09:07 '관찰 중' → 09:09 **정밀 수색 요청** (28번 주변 무선 이어폰) → **근거 보기**
4. **순회** 탭에서 요청을 골라 경로 확인 → **순회 시작** → 신호가 강했던 좌석을 골라 **발견 / 미발견** 입력
5. 09:20 두 번째 요청 (휴대폰, 영상 통화) → 근거 보기의 **Wi-Fi** 탭
6. 09:30 **수신기 R3 꺼짐** 경고 → 3대용 위치 모델로 전환 → 2분 뒤 복구
7. 09:40 시험 종료 → **기록** 탭: 시험 후 리포트
8. 로그아웃 후 **관리자**로 들어가 **관리** 탭 (개요 · 에이전트 · 비상 대응 · 시스템), **검토자**로 들어가 같은 기록을 열람 전용으로 확인

<br/>

## 화면 구성

### 태블릿 (가로 · 기준 화면)

**시험 전**

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/images/tablet/00_login.png" alt="로그인"/><br/><b>① 로그인</b><br/><sub>감독관 · 관리자 · 검토자 계정, 누르면 입력되는 시연용 계정</sub></td>
    <td width="50%" align="center"><img src="docs/images/tablet/01_setup_check.png" alt="준비 · 자가 점검"/><br/><b>② 준비 · 자가 점검</b><br/><sub>수신기 4대 · 기준 비콘 · 시계 동기화 · 펌웨어 서명 · AI 모델 파일을 통과해야 다음 단계</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/tablet/02_setup_baseline.png" alt="준비 · 허용 기기 등록"/><br/><b>③ 준비 · 허용 기기 등록 → 감지 시작</b><br/><sub>입실 전 교실 기기를 탐지 대상에서 빼고, 시험 전 확인 2개를 체크해야 감지 시작</sub></td>
    <td align="center"><img src="docs/images/tablet/03_monitor_clear.png" alt="감독 · 이상 없음"/><br/><b>④ 감독 · 이상 없음</b><br/><sub>평소 화면 · 감독관이 할 일 없음, 오른쪽에 최근 에이전트 판단</sub></td>
  </tr>
</table>

**시험 중**

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/images/tablet/04_monitor_watching.png" alt="감독 · 관찰 중"/><br/><b>⑤ 관찰 중</b><br/><sub>교실 안 새 신호 · 에이전트가 30초 더 지켜봄 (아직 조치 필요 없음)</sub></td>
    <td width="50%" align="center"><img src="docs/images/tablet/05_monitor_request.png" alt="수색 요청 2건 · 범위 메뉴"/><br/><b>⑥ 에이전트 감지 · 수색 요청</b><br/><sub>위험 점수 · 추정 위치 · 근거 2줄 · 범위 ⋮ 메뉴(휴대형 접근 · 근거 보기)</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/tablet/06_evidence_receivers.png" alt="근거 보기"/><br/><b>⑦ 근거 보기</b><br/><sub>대응 단계 · 신호원별 근거 · 이 기기의 시간순 기록</sub></td>
    <td align="center"><img src="docs/images/tablet/07_evidence_wifi.png" alt="근거 · Wi-Fi"/><br/><b>⑧ 근거 · Wi-Fi 탭</b><br/><sub>휴대폰 추정 · 통신 용도 '영상 통화'</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/tablet/08_roam_route.png" alt="순회 경로"/><br/><b>⑨ 순회 · 경로</b><br/><sub>돌 범위와 순서 · 예상 시간 · 좌석을 눌러 넣거나 빼기</sub></td>
    <td align="center"><img src="docs/images/tablet/09_roam_scanning.png" alt="순회 중"/><br/><b>⑩ 순회 · 휴대형 수신기로 탐색</b><br/><sub>이번 순회에서 가장 강했던 곳 대비 · 지금 범위 / 다음 범위</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/tablet/10_roam_result.png" alt="결과 입력"/><br/><b>⑪ 수색 결과 입력</b><br/><sub>신호가 강했던 좌석 순서 · 금속탐지기로 볼 곳 → 발견 / 미발견</sub></td>
    <td align="center"><img src="docs/images/tablet/11_receiver_down.png" alt="수신기 꺼짐"/><br/><b>⑫ 장비 고장 · 수신기 R3 꺼짐</b><br/><sub>경고 배너 · 수신기 3/4 · 3대용 위치 모델로 범위를 넓게 표시</sub></td>
  </tr>
</table>

**시험 후 · 관리**

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/images/tablet/12_report.png" alt="시험 후 리포트"/><br/><b>⑬ 기록 · 시험 후 리포트</b><br/><sub>종합 소견 · 타임라인 · 수색 내역 · 장애 기록 · 감독관 의견 · 판단 기록</sub></td>
    <td width="50%" align="center"><img src="docs/images/tablet/13_admin_overview.png" alt="관리 · 개요"/><br/><b>⑭ 관리 · 개요 (관리자)</b><br/><sub>운영 상태 · 경보 단계별 기기 수 · 장비 · 반입 금지 의심 기기</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/tablet/14_admin_agent.png" alt="관리 · 에이전트"/><br/><b>⑮ 관리 · 에이전트</b><br/><sub>경보 단계 기준 · 기기별 판단 과정 · 에이전트가 쓰는 AI 모델 6개</sub></td>
    <td align="center"><img src="docs/images/tablet/15_admin_faults.png" alt="관리 · 비상 대응"/><br/><b>⑯ 관리 · 비상 대응</b><br/><sub>장비 이상 때 동작 단계 · 장애 3종 · 회피 · 해킹 모의 훈련</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/tablet/16_admin_system.png" alt="관리 · 시스템"/><br/><b>⑰ 관리 · 시스템</b><br/><sub>교실 장비 배치 · 시험 전 자가 점검 · 역할별 권한 · 접근 기록</sub></td>
    <td align="center"><img src="docs/images/tablet/17_auditor_log.png" alt="검토자 · 기록"/><br/><b>⑱ 검토자 · 기록 열람</b><br/><sub>기록 · 관리 화면만 보임 · 입력 버튼 없음</sub></td>
  </tr>
</table>

### 휴대폰 (순회하며 쓰는 화면)

<table>
  <tr>
    <td width="25%" align="center"><img src="docs/images/phone/05_monitor_request.png" alt="정밀 수색 요청"/><br/><b>정밀 수색 요청</b></td>
    <td width="25%" align="center"><img src="docs/images/phone/09_roam_scanning.png" alt="휴대형 수신기로 탐색"/><br/><b>휴대형 수신기로 탐색</b></td>
    <td width="25%" align="center"><img src="docs/images/phone/10_roam_result.png" alt="수색 결과 입력"/><br/><b>수색 결과 입력</b></td>
    <td width="25%" align="center"><img src="docs/images/phone/12_report.png" alt="시험 후 리포트"/><br/><b>시험 후 리포트</b></td>
  </tr>
</table>

<br/>

## AI 에이전트와 모델 6개

판단 주체는 에이전트입니다. 에이전트가 신호마다 필요한 모델만 골라 부르고(교실 전체 1개 + 기기마다 5개), 결과에 따라 다음 경보 단계를 정합니다. 모델은 모두 이 저장소에서 학습하며(`backend/app/ml`), 외부 AI 서비스 · LLM API는 쓰지 않습니다.

**에이전트 경보 단계**

단계마다 **언제 올라가는지 → 감독관이 할 일**입니다.

- **Lv0 이상 없음**: 허용 목록 밖 신호 없음 → 할 일 없음
- **Lv1 추가 관찰**: 위험 40~69점 → 할 일 없음 (에이전트가 30초 더 지켜봄)
- **Lv2 휴대형 접근**: 60점 이상 + 위치 확신, 또는 영상 통화나 사진 전송 → 휴대형 수신기로 수색 범위 순회
- **Lv3 정밀 수색**: 70점 이상 30초 연속 + 근거 2개 이상 → 의심 좌석을 금속탐지기로 수색
- **Lv4 2차 수색**: 정밀 수색에서 못 찾았는데 신호가 계속 잡힘 → 소지품 · 책상 · 다른 신체 부위 확인, 그래도 못 찾으면 '미해결'로 기록해 시험 후 검토

**AI 모델 6개**

| # | 모델 | 질문 | 알고리즘 |
|---|---|---|---|
| ① | 이상 감지 | 교실 전체 신호가 평소와 다른가 | Isolation Forest |
| ② | 기기 묶기 | 주소만 바뀐 같은 기기인가 | 로지스틱 회귀 |
| ③ | 위치 추정 | 교실 안인가 → 어느 구역(약 5석 범위)인가 | 랜덤 포레스트 |
| ④ | Wi-Fi 용도 | 영상 통화 · 음성 · 사진 전송 · 대기 | 랜덤 포레스트 |
| ⑤ | 기기 종류 | 이어폰 · 카메라 안경 · 휴대폰 · 워치 | 랜덤 포레스트 |
| ⑥ | 위험 점수 | 정밀 수색하면 기기가 나올 가능성 | 로지스틱 회귀 |

<br/>

## 실행 방법

### 1) 바로 보기 (설치 없음)

**https://wavespot-daup.vercel.app** — 브라우저만 있으면 됩니다.

### 2) 현장 서버로 실행 (PC 한 대 · 인터넷 불필요)

**필요한 것**: Python 3.11 이상 · Node.js 20 이상. 따로 받을 데이터 · API 키는 없습니다. AI 모델 6개는 설치 단계에서 모의 데이터로 바로 학습하고(약 40초), DB는 처음 실행할 때 자동으로 만들어집니다.

**Windows** (PowerShell, 저장소 폴더에서)
```
powershell -ExecutionPolicy Bypass -File server/scripts/setup.ps1
cd backend; .venv/Scripts/fastapi run app/main.py
```

**macOS · Linux**
```
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m app.ml.train_models
cd ../frontend && npm install && npm run build
cd ../backend && .venv/bin/fastapi run app/main.py
```

브라우저에서 **http://localhost:8000** 을 열고 위 시연용 계정으로 로그인합니다. 같은 와이파이의 태블릿 · 휴대폰은 `http://<PC IP>:8000`. (개발 모드: `server/scripts/dev.ps1` → http://localhost:5173)

<br/>

## 프로젝트 구조

```
WaveSpot/
├── frontend/                  # 감독관 앱 (React 19 · Vite · TypeScript · Tailwind v4)
│   └── src/
│       ├── routes/            #    로그인 · 준비 · 감독 · 순회 · 기록 · 관리 화면
│       ├── components/        #    좌석 배치도 · 에이전트 감지 카드 · 근거 서랍 · 관리 차트
│       ├── lib/               #    API · 실시간 상태(WebSocket) · 역할별 화면(roles.ts)
│       └── demo/              #    웹 시연판: 현장 서버를 브라우저 안(Pyodide)에서 실행
├── backend/app/               # 현장 서버 (FastAPI)
│   ├── agent/                 #    AI 에이전트 · 수색 강화 사다리 · 기기 묶기 · 미발견 처리
│   ├── ml/                    #    AI 모델 6개 · 근거 기반 모의 데이터 · 학습 (train_models.py)
│   ├── services/              #    10초 창 집계 · 녹화 재생 · MQTT 입력 · 장애 · 공격 · 해시 체인
│   ├── api/                   #    REST · WebSocket · 로그인 토큰(auth.py) · 역할별 권한(security.py)
│   └── webdemo.py             #    웹 시연판 어댑터 (ASGI 직접 호출)
├── db/                        # SQLite 스키마
├── server/                    # 실행 스크립트 · MQTT 재생 송출 · web/(웹 시연판 빌드)
├── firmware/                  # ESP32 수신기 펌웨어 (설치형 R1~R4 · 휴대형 H1)
└── docs/                      # API.md · README 이미지
```

<br/>

## 기술 스택

![React](https://img.shields.io/badge/React_19-Vite_·_TypeScript-1F3864?style=flat-square&logo=react&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind_CSS_v4-Radix_·_TanStack-1F3864?style=flat-square&logo=tailwindcss&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-REST_·_WebSocket-2563EB?style=flat-square&logo=fastapi&logoColor=white)
![scikit-learn](https://img.shields.io/badge/scikit--learn-RF_·_LR_·_Isolation_Forest-2563EB?style=flat-square&logo=scikitlearn&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-SQLModel-64748B?style=flat-square&logo=sqlite&logoColor=white)
![MQTT](https://img.shields.io/badge/MQTT-Mosquitto-64748B?style=flat-square&logo=eclipsemosquitto&logoColor=white)
![ESP32](https://img.shields.io/badge/ESP32-NimBLE_·_PlatformIO-64748B?style=flat-square&logo=espressif&logoColor=white)
![Pyodide](https://img.shields.io/badge/Pyodide-웹_시연판-94A3B8?style=flat-square&logo=webassembly&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-배포-94A3B8?style=flat-square&logo=vercel&logoColor=white)

<br/>

## 팀 DAUP

| GitHub |
|---|
| [@onlyho12-sketch](https://github.com/onlyho12-sketch) |
| [@ddoo0922](https://github.com/ddoo0922) |

<br/>

## Credits / Licenses

**오픈소스 (프론트엔드)**

| 이름 | 라이선스 | 링크 | 용도 |
|---|---|---|---|
| React · React DOM | MIT | github.com/facebook/react | 화면 |
| Vite · @vitejs/plugin-react | MIT | github.com/vitejs/vite | 빌드 · 개발 서버 |
| TypeScript | Apache-2.0 | github.com/microsoft/TypeScript | 언어 |
| Tailwind CSS · @tailwindcss/vite | MIT | github.com/tailwindlabs/tailwindcss | 스타일 |
| Radix UI (dialog · slot · tooltip) | MIT | github.com/radix-ui/primitives | 서랍 · 확인창 |
| TanStack Router · Query | MIT | github.com/TanStack | 화면 이동 · 데이터 요청 |
| lucide-react | ISC | github.com/lucide-icons/lucide | 아이콘 |
| class-variance-authority | Apache-2.0 | github.com/joe-bell/cva | 버튼 변형 |
| clsx · tailwind-merge | MIT | github.com/lukeed/clsx · github.com/dcastil/tailwind-merge | 클래스 조합 |
| Pyodide (CDN에서 불러옴) | MPL-2.0 | github.com/pyodide/pyodide | 웹 시연판: 브라우저 안 Python 실행 |

**오픈소스 (백엔드)**

| 이름 | 라이선스 | 링크 | 용도 |
|---|---|---|---|
| FastAPI · Starlette · Uvicorn | MIT · BSD-3-Clause | github.com/fastapi/fastapi | 서버 |
| SQLModel · SQLAlchemy · Pydantic · pydantic-settings | MIT | github.com/fastapi/sqlmodel | DB · 설정 |
| scikit-learn · joblib · SciPy | BSD-3-Clause | github.com/scikit-learn/scikit-learn | AI 모델 학습 · 저장 |
| NumPy · pandas | BSD-3-Clause | github.com/numpy/numpy · github.com/pandas-dev/pandas | 계산 |
| aiomqtt · paho-mqtt | BSD-3-Clause · EPL-2.0 / BSD-3-Clause | github.com/empicano/aiomqtt · github.com/eclipse/paho.mqtt.python | 수신기 MQTT 입력 |
| Eclipse Mosquitto (설정 파일만 포함) | EPL-2.0 / EDL-1.0 | github.com/eclipse/mosquitto | MQTT 브로커 |

**오픈소스 (수신기 펌웨어)**

| 이름 | 라이선스 | 링크 | 용도 |
|---|---|---|---|
| Arduino-ESP32 core | LGPL-2.1 | github.com/espressif/arduino-esp32 | ESP32 기본 라이브러리 |
| NimBLE-Arduino | Apache-2.0 | github.com/h2zero/NimBLE-Arduino | BLE 수동 스캔 |
| PubSubClient | MIT | github.com/knolleary/pubsubclient | MQTT 송출 |

**글꼴**

| 자료명 | 제작자 · 출처 | 라이선스 |
|---|---|---|
| Pretendard | orioncactus · github.com/orioncactus/pretendard | SIL Open Font License 1.1 |

**데이터 · 논문 (모의 데이터 파라미터 근거, 원본 데이터는 저장소에 포함하지 않음)**

| 데이터 · 자료 | 제공 · 출처 | 라이선스 | 용도 |
|---|---|---|---|
| Indoor Environment Dataset Based on RSSI Collected with Bluetooth Devices | Assayag, Y. (2024), Mendeley Data V1, doi:10.17632/3v9mcsvcd2.1 | CC BY 4.0 | 신호 세기-거리 모델 적합 (1 m -74.3 dBm · n 1.67 · σ 5.8 dB) |
| Bluetooth Low Energy (BLE) Dataset: Raw-Capture for Intrusion Analysis | Rauf, U., Martinez, A., Mohsen, F. (2026), Mendeley Data V2, doi:10.17632/ntmmcw6jj8.2 | CC BY 4.0 | 주소 변경 · 기기 묶기 · 이상 감지 실험, 광고 간격(104 · 274 ms) |
| Leith & Farrell (2020), 인체 차폐에 따른 BLE 감쇠 | arXiv:2006.06822 | 논문 인용 | 인체 차폐 10~20 dB |
| MacMillan et al. (2021), 영상 통화 트래픽 측정, ACM IMC | arXiv:2105.13478 | 논문 인용 | 영상 통화 대역폭 |
| Huang et al. (2012), 스마트폰 트래픽 분석, ACM IMC | 논문 | 논문 인용 | 대기 상태 트래픽 |
| WebRTC 패킷 크기 · WhatsApp 통화 분석 | libwebrtc (kVideoMtu) · webrtcHacks | 공개 자료 인용 | 영상 패킷 크기 · 음성 패킷 수 |

라이선스가 표기되지 않은 공개 교실 BLE 데이터(40석)는 내부 참고 검증에만 썼으며, 모델 학습과 저장소에는 쓰지 않았습니다.

**설계 참고 (코드는 포함하지 않음)**

| 이름 | 라이선스 | 참고한 내용 |
|---|---|---|
| Bermuda (github.com/agittins/bermuda) | MIT | 실제 기기 1대 = 메타기기, 바뀐 주소 = 출처 목록, 출처 수명 16분 |
| ESPresense · ESPresense-companion (github.com/ESPresense) | AGPL-3.0 · Apache-2.0 | ESP32 수신기 → MQTT 토픽 이름 구조, 위치 판단 과정 단계별 설명 방식 |
| full-stack-fastapi-template (github.com/fastapi/full-stack-fastapi-template) | MIT | 폴더 구조 (api · core · models) |
| shadcn/ui (ui.shadcn.com) | MIT | 버튼 · 시트 구성 방식 |
| Material 3 window size classes | 공개 가이드 | 태블릿 · 휴대폰 화면 폭 기준 |

화면 패턴은 Atlassian · IBM Carbon 디자인 시스템과 위치 추적 · 무선 탐지 · 모니터링 제품의 공개 화면을 참고했으며, 이들의 코드 · 이미지는 포함하지 않았습니다.

**로고**: WaveSpot 로고 · 아이콘 (`frontend/public`) · 팀 DAUP 제작

<br/>

<div align="center">

**WaveSpot** · 팀 DAUP

</div>

