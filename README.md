<div align="center">

<img src="docs/images/logo.png" width="560" alt="WaveSpot · 공정한 시험을 돕는 AI 감독 에이전트 플랫폼"/>

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
| **바로 실행** | **https://wavespot-daup.vercel.app** · 설치 · 로그인 · API 키 없음 |
| **첫 화면까지** | 처음 한 번 30초~1분 (현장 서버와 AI 모델 6개를 브라우저 안에 불러옴) |
| **권장 화면** | 태블릿 가로(기준 화면) · PC 브라우저 · 휴대폰 모두 지원 |
| **5분 시연 순서** | [직접 눌러 보는 순서](#직접-눌러-보는-시연-순서-약-5분) |
| **현장 서버로 실행** | [실행 방법](#실행-방법) (PC 한 대 · 인터넷 불필요) |
| **데이터** | 시연 신호는 공개 데이터 · 논문 수치로 만든 **근거 기반 모의 데이터** (실측 아님) |

</td>
    <td width="28%" align="center"><img src="docs/images/qr_wavespot.png" width="180" alt="wavespot-daup.vercel.app QR 코드"/><br/><sub>휴대폰 카메라로 찍으면 바로 열림</sub></td>
  </tr>
</table>

> **웹 시연판은 어떻게 도나요?** 현장에서는 `천장 수신기 → 현장 서버 → 감독관 앱`으로 나뉘어 돌아갑니다. 링크만으로 볼 수 있도록, **같은 현장 서버 코드(FastAPI · AI 에이전트 · AI 모델 6개)를 브라우저 안(Pyodide · WebAssembly)에서 그대로 실행**합니다. 화면 코드는 현장과 같고 `/api` 요청만 브라우저 안 서버로 연결됩니다. 새로고침하면 새 교시로 다시 시작합니다.

<br/>

## 문제와 해결

초소형 카메라 · 무선 이어폰으로 문제를 밖에 보내고 생성형 AI의 답을 받는 부정행위가 **청년의 취업 관문인 국가자격 · 채용 시험**까지 번졌습니다 (2026년 국가자격 스마트안경 적발 12건, 세무사 수석 합격자 자백 · 감독위원 4명 미적발). 기기를 몸이나 소지품에 숨기면 눈으로 찾기 어렵고, 전원을 다 뒤지면 시간이 걸리고 성실한 수험생에게 부담이 됩니다.

감독관에게 필요한 것은 **"지금 문제가 있나 → 어디를 → 무엇을 할지"** 입니다.

| | 지금 방식 | **WaveSpot** |
|---|---|---|
| 찾는 방법 | 눈으로 보기 · 신호 유무만 알려 주는 탐지기 | 천장 수신기 4대 + AI가 **교실 안 숨은 기기**인지 판단 |
| 수색 범위 | 교실 전체 · 의심 가는 사람 | **반쪽 줄(5석) → 휴대형 순회로 좌석 1곳** |
| 평소 감독관 할 일 | 계속 둘러보기 | 없음 ('이상 없음') · **의심될 때만 요청** |
| 옆 교실 · 감독관 폰 | 구분 못 함 | 교실 안/밖 판단 · 입실 전 **기준선**으로 미리 허용 |
| 수색 근거 | 감독관의 느낌 | 근거 · **틀릴 수 있는 이유** · 볼 부위 · 판단 기록 |
| 최종 판단 | 사람 | 사람 (기기를 찾았을 때만 확정) |

**대상 사용자**: 시험 감독관(태블릿 · 휴대폰), 시험장 관리자 · **수혜자**: 취업 · 자격 시험을 준비하는 청년 수험생 (취업시험 준비 청년 60만 명, 국가기술자격 응시자의 57.7%가 20 · 30대)

<br/>

## 감독관이 얻는 효과

> 🟦 **공개 데이터 실험** = 실제로 수집된 공개 BLE 기록으로 팀이 직접 잰 값  ·  🟨 **근거 기반 모의** = 공개 데이터 · 논문 수치로 만든 모의 데이터에서 잰 값 (실측 전)

| 감독관이 얻는 것 | 결과 | 근거 |
|---|---|---|
| **부정행위자가 없으면 헛걸음하지 않음** | 정상 40분 · **잘못된 수색 요청 0회** (30초 연속 확인 + 입실 전 기준선 보정) | 🟦 공개 BLE 원본 12시간 |
| | 100분 교시 · **수색 요청 0회** | 🟨 앱 `quiet` 시나리오 |
| **규칙이 놓치는 약한 공격을 잡음** | 공격을 1/10로 약하게 숨겨도 규칙 **0%** → AI(이상 감지) **89.2%** | 🟦 공개 BLE 스팸 공격 기록 |
| **수색 범위가 좁아짐** | 교실 40석 → **반쪽 줄 5석**: AI **47.9%** vs 규칙 24.5% vs 무작위 12.3% | 🟦 실제 교실 40석 공개 데이터 (내부 검증만) |
| | 휴대형으로 좌석 옆 2초 머물면 **좌석 76~91%**, ±1석 98% 이상 | 🟨 경로손실 · 인체 차폐 논문값 |
| **영상 통화 · 사진 전송을 구분** | Wi-Fi 용도 10초 판단 AI **97.9%** vs 통신량 규칙 75.6% | 🟨 논문 트래픽 수치 |
| **주소를 바꿔도 한 대로 추적** | 바뀐 주소 이어 붙이기 규칙 82.5% → AI **93.7%** (잘못 연결 0%) | 🟦 공개 BLE 원본 |
| **주소를 15초마다 바꾸는 공격** | 이상 감지 모델이 **50초 만에** 탐지 (규칙보다 20초 빠름) → Lv3 정밀 수색 | 🟨 앱 공격 재현 |
| **장비가 고장 나도 감시 유지** | 수신기 1대 꺼짐 → 3대용 위치 모델로 자동 전환, 2분 뒤 복구 | 🟨 앱 시연 09:55 |

<br/>

## 시연 시나리오

한 교시(100분)를 녹화 재생으로 돌리며, 설계안의 상황 ①~⑦이 순서대로 나옵니다. 재생 속도를 **60배**로 바꾸면 약 2분이면 끝납니다.

```mermaid
flowchart LR
    A["준비<br/>수신기 점검 · 기준선<br/>(감독관 폰 · TV 허용)"] --> B["Lv0 감시<br/>이상 없음<br/>옆 교실 워치는 '교실 밖'"]
    B --> C["Lv1 관찰<br/>숨긴 이어폰 신호<br/>30초 연속 확인"]
    C --> D["Lv3 정밀 수색<br/>6구역 · 위험 점수<br/>근거 카드"]
    D --> E["휴대형 순회<br/>가까워짐 → 가장 가까움<br/>좌석 특정"]
    E --> F["결과 입력<br/>발견 / 미발견<br/>(미발견 + 신호 지속 → Lv4)"]
    F --> G["장비 고장<br/>수신기 R3 꺼짐<br/>3대용 모델 전환"]
    G --> H["기록<br/>시험 후 리포트<br/>위변조 확인"]
```

| 시각 | 상황 (설계안) | 감독관 화면 | 에이전트가 한 일 |
|---|---|---|---|
| 입실 전 | ① 정상 기기 | 준비 탭 · 기준선 만들기 | 입실 전 20분 신호를 묶어 감독관 폰 · TV를 허용 목록에 등록 |
| 09:02 | ② 옆 교실 스마트워치 | 변화 없음 (이상 없음) | 기기 묶기 → 교실 안/밖 = **밖** → 확인 끝 (나머지 모델 건너뜀) |
| 09:07 | ④ 숨긴 무선 이어폰 | 좌석 배치도에 '관찰 중' → **AI 감지 카드** | 30초 연속 확인 → 위치 · 종류 · 위험 점수 → 근거 2개 이상이면 **Lv3 정밀 수색** |
| 09:15 | ③ 감독관 폰 주소 변경 | 변화 없음 | 기기 묶기 모델이 같은 기기로 연결 → 확인 끝 (가짜 새 기기 방지) |
| 09:30 | ⑤ 숨긴 휴대폰 영상 통화 | 바로 **휴대형 접근** 요청 | Wi-Fi 용도 모델 먼저 → 영상 통화면 위치 확신이 낮아도 Lv2 즉시 |
| 순회 | 휴대형으로 좌석 특정 | 가까워짐 · 가장 가까움 · 진동 | 신호가 강했던 좌석 순서 제시 → 감독관이 **발견 / 미발견** 입력 |
| 09:55 | ⑦ 수신기 R3 꺼짐 | 빨간 경고 · 수신기 3/4 | 3대용 위치 모델로 전환 · 구역을 넓게 표시 → 2분 뒤 4대로 복귀 |
| 10:40 | 시험 종료 | 기록 탭 · 시험 후 리포트 | 타임라인 · 수색 내역 · 장애 기록 · 해시 체인 위변조 확인 |

<br/>

## 화면 구성

### 태블릿 (가로 · 기준 화면)

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/images/tablet/02_setup_baseline.png" alt="준비 · 기준선"/><br/><b>① 준비 · 기준선 만들기</b><br/><sub>입실 전 신호를 허용 목록에 등록 · 시험 전 확인 2개를 체크해야 감시 시작</sub></td>
    <td width="50%" align="center"><img src="docs/images/tablet/03_monitor_clear.png" alt="감독 · 이상 없음"/><br/><b>② 감독 · 이상 없음</b><br/><sub>평소 화면 · 감독관이 할 일 없음</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/tablet/04_monitor_watching.png" alt="감독 · 관찰 중"/><br/><b>③ 관찰 중</b><br/><sub>교실 안 새 신호 · 30초 연속 확인 중 (요청 없음)</sub></td>
    <td align="center"><img src="docs/images/tablet/05_monitor_request.png" alt="정밀 수색 요청"/><br/><b>④ AI 감지 · 정밀 수색 요청</b><br/><sub>위험 점수 · 대상 구역 · 근거 2줄 · 1순위/2순위 구역</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/tablet/08_evidence_receivers.png" alt="근거 서랍"/><br/><b>⑤ 근거 보기</b><br/><sub>근거 · 틀릴 수 있는 이유 · 금속탐지기로 볼 곳 · 수색 후 할 일</sub></td>
    <td align="center"><img src="docs/images/tablet/09_evidence_wifi.png" alt="근거 · Wi-Fi"/><br/><b>⑥ 근거 · Wi-Fi 탭</b><br/><sub>신호원별 근거 (천장 수신기 · 휴대형 · Wi-Fi)</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/tablet/10_roam_route.png" alt="순회 경로"/><br/><b>⑦ 순회 · 경로 설정</b><br/><sub>돌 구역 순서 · 좌석마다 머무는 시간 · 예상 시간</sub></td>
    <td align="center"><img src="docs/images/tablet/11_roam_scanning.png" alt="순회 중"/><br/><b>⑧ 순회 · 정밀 탐색 중</b><br/><sub>최고값 대비 게이지 · 지금 구역 / 다음 구역</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/tablet/12_roam_result.png" alt="결과 입력"/><br/><b>⑨ 결과 입력</b><br/><sub>강하게 들린 좌석 순서 → 발견 / 미발견</sub></td>
    <td align="center"><img src="docs/images/tablet/13_receiver_down.png" alt="수신기 꺼짐"/><br/><b>⑩ 장비 고장 · 수신기 R3 꺼짐</b><br/><sub>경고 배너 · 수신기 3/4 · 3대용 위치 모델</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/tablet/14_report.png" alt="시험 후 리포트"/><br/><b>⑪ 기록 · 시험 후 리포트</b><br/><sub>종합 소견 · 교시 타임라인 · 수색 내역 · 감독관 의견</sub></td>
    <td align="center"><img src="docs/images/tablet/15_admin_agent.png" alt="관리 · AI 판단"/><br/><b>⑫ 관리 · AI 판단 흐름</b><br/><sub>기기마다 부른 모델 · 건너뛴 모델 · 모델 호출 절감</sub></td>
  </tr>
</table>

<details>
<summary>태블릿 화면 더 보기 (장비 점검 · 구역 메뉴 · 장애 · 공격 재현)</summary>
<br/>
<table>
  <tr>
    <td width="33%" align="center"><img src="docs/images/tablet/01_setup_check.png" alt="장비 점검"/><br/><sub>준비 · 수신기 장비 점검</sub></td>
    <td width="33%" align="center"><img src="docs/images/tablet/06_monitor_zone_menu.png" alt="구역 메뉴"/><br/><sub>구역 메뉴 · 휴대형 접근 · 근거 · 결과</sub></td>
    <td width="33%" align="center"><img src="docs/images/tablet/07_admin_faults.png" alt="장애 · 공격"/><br/><sub>관리 · 장애 · 공격 재현 (장비 이상 때 동작 단계)</sub></td>
  </tr>
</table>
</details>

### 휴대폰 (순회하며 쓰는 화면)

<table>
  <tr>
    <td width="25%" align="center"><img src="docs/images/phone/03_monitor_clear.png" alt="이상 없음"/><br/><b>이상 없음</b></td>
    <td width="25%" align="center"><img src="docs/images/phone/05_monitor_request.png" alt="정밀 수색 요청"/><br/><b>정밀 수색 요청</b></td>
    <td width="25%" align="center"><img src="docs/images/phone/08_evidence_receivers.png" alt="근거 보기"/><br/><b>근거 보기</b></td>
    <td width="25%" align="center"><img src="docs/images/phone/10_roam_route.png" alt="순회 경로"/><br/><b>순회 경로</b></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/images/phone/11_roam_scanning.png" alt="정밀 탐색"/><br/><b>정밀 탐색 (전체 화면)</b></td>
    <td align="center"><img src="docs/images/phone/12_roam_result.png" alt="결과 입력"/><br/><b>결과 입력</b></td>
    <td align="center"><img src="docs/images/phone/13_receiver_down.png" alt="수신기 꺼짐"/><br/><b>수신기 꺼짐 경고</b></td>
    <td align="center"><img src="docs/images/phone/14_report.png" alt="시험 후 리포트"/><br/><b>시험 후 리포트</b></td>
  </tr>
</table>

<sub>화면 캡처는 녹화 재생(모의 데이터) 중에 찍었습니다. 위험 점수 등 세부 숫자는 실행할 때마다 조금씩 다를 수 있습니다.</sub>

<br/>

## AI 에이전트와 모델 6개

모델은 **질문 하나에 답하는 도구**이고, 에이전트는 **어떤 질문을 언제 할지 정하고 결과를 보고 다음 행동을 고릅니다.** 모든 신호에 모델을 다 돌리지 않고, 단서에 따라 필요한 모델만 부르고 나머지는 건너뜁니다.

```mermaid
flowchart LR
    R["천장 수신기 4대<br/>BLE 세기 · Wi-Fi 프레임<br/>(10초 창)"] --> AN["① 이상 감지<br/>교실 전체가 평소와 다른가"]
    R --> LK["② 기기 묶기<br/>주소만 바뀐 같은 기기인가"]
    LK -- 허용 기기 --> END1["확인 끝"]
    LK --> IO["③ 위치 추정 · 교실 안/밖"]
    IO -- 밖 --> END2["확인 끝 · 기록만"]
    IO -- 안 · 30초 연속 --> ZN["③ 위치 추정 · 반쪽 줄 구역"]
    ZN --> Q{"Wi-Fi가<br/>잡히나"}
    Q -- 예 --> US["④ Wi-Fi 용도<br/>영상 · 음성 · 사진 · 대기"]
    Q -- 아니오 --> KD["⑤ 기기 종류<br/>이어폰 · 안경 · 폰 · 워치"]
    US --> SC["⑥ 위험 점수"]
    KD --> SC
    SC --> L{"더 지켜볼 때 얻는 확신<br/>vs 놓칠 위험"}
    L -- 기다림 --> LV1["Lv1 30초 더 관찰"]
    L -- 영상 · 사진 / 확신 충분 --> LV2["Lv2 휴대형 접근"]
    SC -- "기준 점수 30초 연속<br/>+ 근거 2개 이상" --> LV3["Lv3 정밀 수색 요청"]
```

**6개 모두 이 저장소 코드에서 학습되고, 에이전트가 실제로 부릅니다** (`backend/app/ml` · `backend/app/agent`). 모델을 나눈 이유: '부정행위 여부' 정답 데이터는 없지만 '어디 · 무엇 · 같은 기기 · 무슨 용도'는 질문별로 공개 데이터가 있고, 입력 시간 단위(몇 초 ~ 10분)도 다르기 때문입니다.

| # | 모델 | 질문 | 알고리즘 | 언제 부르나 | 학습 데이터 | 모의 평가 (처음 보는 위치 · 세션) |
|---|---|---|---|---|---|---|
| ① | **이상 감지** | 교실 전체 신호가 평소와 다른가 | Isolation Forest | 10초마다 1번 (Lv0 감시) | 🟨 정상 교실 30초 창 (허용 기기 · 복도 신호 · 주소 변경) | 정상 창 오경보 0.9% · 30초 연속일 때만 기록 |
| ② | **기기 묶기** | 주소만 바뀐 같은 기기인가 | 로지스틱 회귀 | 새 주소가 나타날 때 | 🟨 같은 자리 기기의 주소 변경 vs 다른 기기 | 같은 기기 99.8% 연결 · 다른 기기를 잘못 이을 확률 18% → 1·2위 차이가 작으면 잇지 않고 30초 보류 |
| ③ | **위치 추정** | 교실 안인가 → 어느 반쪽 줄(5석)인가 | 랜덤 포레스트 2개 (+ 수신기 1대 빠진 4조합) | 허용 목록 밖 신호 | 🟨 공개 데이터 적합 경로손실 + 인체 차폐 | 안/밖 90% · 5석 구역 10초 29% → 30초 누적 45% → 60초 51% |
| ④ | **Wi-Fi 용도** | 영상 통화 · 음성 · 사진 전송 · 대기 | 랜덤 포레스트 | Wi-Fi 프레임이 잡힐 때 | 🟨 논문 트래픽 수치 (암호화된 내용은 보지 않음) | 10초 97% |
| ⑤ | **기기 종류** | 이어폰 · 카메라 안경 · 휴대폰 · 워치 | 랜덤 포레스트 | 블루투스만 잡힐 때 | 🟨 공개 BLE 광고 간격 + 기기별 가정 | 89% (팀 기기 수집 후 교체) |
| ⑥ | **위험 점수** | 정밀 수색하면 기기가 나올 가능성 | 로지스틱 회귀 | 위치까지 확인된 기기 | 🟨 설계안 배점을 사전 지식으로 만든 수색 결과 | AUC 0.84 · 항목별 기여를 근거 카드에 표시 |

- **에이전트인 이유**: 같은 기록에 '모든 모델을 매번 실행'과 비교하면 모델 호출이 **약 59% (시연) ~ 76% (부정행위자 없는 교시)** 줄어듭니다. 허용 기기는 묶기만, 교실 밖 신호는 안/밖까지만 보고 멈추기 때문입니다 (앱 **관리 → AI 판단**에서 실시간 확인).
- **기다릴지 바로 부를지**: 점수가 넘으면 바로 알리는 파이프라인과 달리, '30초 더 볼 때 오르는 구역 확신' 과 '놓칠 위험'을 비교합니다. 영상 · 사진 전송이면 확신이 낮아도 바로 휴대형 접근(Lv2).
- **외부 AI 서비스 · LLM API는 쓰지 않습니다.** 10초 단위 실시간 판단을 현장 서버(라즈베리파이)에서 인터넷 없이 해야 하고, 수험생 신호를 밖으로 보내지 않기 위해서입니다.
- 위 모델 정확도는 모두 🟨 근거 기반 모의 데이터 값입니다. 공개 데이터 실험(🟦)은 [감독관이 얻는 효과](#감독관이-얻는-효과)에 따로 적었습니다.

<br/>

## AI 오류 · 불확실성 대응

| 위험 | 대응 |
|---|---|
| 무고한 수험생 수색 | 근거 2개 미만이면 수색 요청 금지, 기준 점수가 **30초 연속**일 때만 Lv3. 부정행위 확정은 **기기를 찾았을 때만** (감독관이 직접 입력) |
| AI가 틀릴 수 있음 | 근거 카드에 **틀릴 수 있는 이유**(교실 밖 가능성 · 1·2순위 구역이 비슷함 · 수신기 고장 중 등)와 2순위 구역을 함께 표시 |
| 확신이 낮음 | 규칙으로 물러서지 않고 **수색 강화 사다리**로 근거를 더 모음: Lv1 30초 관찰 → Lv2 휴대형 접근 → Lv3 정밀 수색 → Lv4 2차 수색 |
| 못 찾음 | 신호가 계속되면 2차 수색 · 학습 보류, 2차도 미발견이면 '미해결'로 사람 검토. 신호가 사라지면 오탐 기록. **시험 중에는 점수 · 기준을 바꾸지 않음** |
| 장비 · 시스템 장애 | 수신기 1대 끊김 → 3대용 위치 모델 / 2대 이상 → 위치 추정 중지 · 순회 권장 / 서버 재시작 → 10초마다 저장한 상태로 이어서 / 망 장애 → '감시 중단 · 수동 감독' (멈추면 '이상 없음'으로 보이지 않음) / 모델 오류 → 그 모델만 규칙 점수 |
| 우회 · 해킹 | 기준 점수를 교시마다 비공개로 조금씩 바꿈, 짧게 끊어 보내도 교시 단위 누적, 다가오면 끄는 반응 · 잦은 주소 변경 · 허용 기기 위장을 근거로 사용, 불가능한 세기 조합 거부, 판단 기록 **해시 체인** |

앱 **관리 → 장애 · 공격** 탭에서 장애 8종 · 공격 7종을 직접 재현해 볼 수 있습니다 (역할을 '관리자'로 바꾼 뒤).

<br/>

## 차별점

- **기기 모양이 아니라 무선 신호를 봅니다** — 안경 · 이어폰 · 워치로 모양이 바뀌어도 밖과 연결하려면 무선이 필요합니다.
- **평소엔 조용, 의심될 때만** — 전원 검사 대신 구역 → 좌석 순서로 좁혀, 감독관의 수색 횟수와 수험생 부담을 줄입니다.
- **근거가 남는 판단** — 점수 하나가 아니라 모델별 근거 · 반대 근거 · 판단 기록을 남겨 이의 제기에 답할 수 있습니다.
- **주소가 바뀌는 기기도 한 대로**, 입실 전 기준선으로 감독관 · 시험장 기기를 미리 걸러 냅니다.
- **오프라인 · 개인정보 최소화** — 교실 내부망에서만 동작하고, 수험생 이름 대신 좌석 번호만 씁니다.

<br/>

## 직접 눌러 보는 시연 순서 (약 5분)

1. **준비** 탭: 수신기 점검 표 확인 → **기준선 만들기** → 시험 전 확인 2개 체크 → **감시 시작**
2. 재생 속도를 **60배**로 바꾸면 100분 교시가 약 2분에 재생됩니다.
3. **감독** 탭: 평소 '이상 없음' → 좌석 배치도에 '관찰 중' → 오른쪽 **AI 감지 카드** (위험 점수 · 근거 2줄)
4. 카드의 **근거 보기**: 근거 · 틀릴 수 있는 이유 · 금속탐지기로 볼 곳, 신호원별 탭
5. **휴대형으로 접근** → 순회 경로 확인 → '가까워짐 / 가장 가까움' → 좌석을 골라 **발견 / 미발견**
6. 09:55 무렵 **수신기 R3 꺼짐** 경고 → 3대용 위치 모델 · 넓은 범위 → 2분 뒤 복구
7. **기록** 탭: 시험 후 리포트 / **관리** 탭: 개요 · **AI 판단**(모델 6개 호출 · 건너뜀, 기기별 판단 흐름) · 장애 · 공격 · 장비 · 보안
8. (선택) 관리 탭 오른쪽 위 역할을 '관리자'로 → **장애 · 공격** 탭에서 장애 · 공격 재현 (탐지 여부 · 걸린 시간 · 최고 대응 단계 기록)

<br/>

## 구현 현황과 한계

| 구분 | 상태 |
|---|---|
| 감독관 앱 (준비 · 감독 · 순회 · 기록 · 관리, 태블릿 · 휴대폰) | ✅ 작동 |
| AI 에이전트 · **AI 모델 6개** · 판단 기록 · 시험 후 리포트 | ✅ 작동 (근거 기반 모의 데이터로 학습) |
| 녹화 재생 시연 (`demo` 상황 ①~⑦ · `quiet` 부정행위자 없는 교시) · 장애 8종 · 공격 7종 재현 | ✅ 작동 |
| 웹 시연판 (같은 서버 코드를 브라우저 안에서 실행 · Vercel) | ✅ 작동 |
| 실제 수신기 입력 (MQTT · ESPresense 방식 토픽) | 🟡 재생 데이터를 브로커로 보내 수신 → 판단 → 요청까지 확인 · 실기기 기준선 수집은 예정 |
| 수신기 펌웨어 (ESP32 · BLE 수동 스캔 + Wi-Fi 감청) | 🟡 문법 검사 완료 · 실제 보드 확인 예정 |
| 실측 데이터로 모델 교체 (교실 기준점 · 팀 기기 · 용도 재현 · 수색 결과) | ⏳ 예정 |

**현재 한계**
- 모델 6개 모두 근거 기반 모의 데이터로 학습했습니다. 특히 **기기 종류**(광고 간격 가정)와 **위험 점수**(수색 결과 기록이 없어 설계안 배점을 사전 지식으로 사용)는 팀 기기 수집 · 실제 수색 결과로 다시 학습해야 합니다.
- 휴대형 순회는 재생 모드에서만 모의 세기로 동작합니다.
- 웹 시연판은 브라우저 메모리에서 돌아 새로고침하면 처음부터 시작하며, 웹용으로 나무 수를 줄인 모델(같은 코드 · 같은 데이터)을 씁니다.

<br/>

## 활용 · 확장

- **설치**: 교실당 천장 수신기(ESP32) 4대 + 현장 서버 1대(PC 또는 라즈베리파이, `server/scripts/run_pi.sh`). 외부 API 사용료 없음.
- **운영 부담**: 감독관은 시험 전 기준선 버튼 한 번, 시험 중에는 요청이 올 때만 움직입니다.
- **확장**: 교실 여러 곳을 한 서버로 묶는 시험장 대시보드, 실측 데이터 재학습(위치 모델은 교실마다 기준점 10곳으로 맞춤 학습), 기관 시스템 연동.

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

## 프로젝트 구조

```
WaveSpot/
├── frontend/                  # 감독관 앱 (React 19 · Vite · TypeScript · Tailwind v4)
│   └── src/
│       ├── routes/            #    준비 · 감독 · 순회 · 기록 · 관리 화면
│       ├── components/        #    좌석 배치도 · AI 감지 카드 · 근거 서랍 · 관리 차트
│       ├── lib/               #    API · 실시간 상태(WebSocket)
│       └── demo/              #    웹 시연판: 현장 서버를 브라우저 안(Pyodide)에서 실행
├── backend/app/               # 현장 서버 (FastAPI)
│   ├── agent/                 #    AI 에이전트 · 수색 강화 사다리 · 기기 묶기 · 미발견 처리
│   ├── ml/                    #    AI 모델 6개 · 근거 기반 모의 데이터 · 학습 (train_models.py)
│   ├── services/              #    10초 창 집계 · 녹화 재생 · MQTT 입력 · 장애 · 공격 · 해시 체인
│   ├── api/                   #    REST · WebSocket · 역할별 권한
│   └── webdemo.py             #    웹 시연판 어댑터 (ASGI 직접 호출)
├── db/                        # SQLite 스키마
├── server/                    # 실행 스크립트 · MQTT 재생 송출 · web/(웹 시연판 빌드)
├── firmware/                  # ESP32 수신기 펌웨어 (설치형 R1~R4 · 휴대형 H1)
└── docs/                      # API.md · README 이미지
```

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

브라우저에서 **http://localhost:8000** 을 엽니다. 같은 와이파이의 태블릿 · 휴대폰은 `http://<PC IP>:8000`. (개발 모드: `server/scripts/dev.ps1` → http://localhost:5173)

### 3) 웹 시연판 다시 빌드 (Vercel)

```
powershell -ExecutionPolicy Bypass -File server/web/build.ps1   # 웹용 모델 학습(scikit-learn 1.7.0) · 서버 코드 묶기 · 빌드
cd frontend/dist-web; vercel deploy --prod
```

<br/>

## 개인정보 · 보안

- 수험생 이름 · 얼굴 등 개인정보를 다루지 않고 **좌석 번호만** 씁니다.
- 기기 주소는 해시로만 저장하고, 무선 신호의 내용(암호화된 데이터)은 보지 않습니다 (Wi-Fi는 프레임 길이 · 시각 · 방향만).
- 시연 데이터는 모두 모의 데이터이며, 외부 AI 서비스로 보내는 데이터가 없습니다. 웹 시연판도 모든 계산이 보는 사람의 브라우저 안에서 끝납니다.
- 저장소에 API 키 · 비밀번호가 없습니다 (설정은 환경 변수 `WAVESPOT_*` 또는 `backend/.env`, `.gitignore` 처리).

<br/>

## AI 활용 내역 (개발 과정)

| 항목 | 내용 |
|---|---|
| 서비스에 쓴 AI | 직접 학습한 scikit-learn 모델 6개 (랜덤 포레스트 · 로지스틱 회귀 · Isolation Forest) + 이를 고르는 AI 에이전트. 외부 AI API · LLM 사용 없음 |
| 개발에 쓴 AI 도구 | Claude Code (Anthropic): 코드 작성 · 리팩터링 · 디버깅 · 화면 구현 · 문서 초안 |
| AI가 한 일 | 프론트엔드 · 백엔드 코드 초안과 수정, 모의 데이터 생성 코드, 웹 시연판 어댑터, 화면 캡처 · 실행 검증 스크립트, 문서 초안 |
| 팀이 한 일 | 문제 정의, 설계안(v1~v12) 작성과 판단 규칙(수색 강화 사다리 · 70점 기준 · 미발견 처리) 결정, 데이터 · 논문 수치 선정, 화면 레퍼런스 선정과 디자인 방향 결정, 화면 문구 검수, 결과 확인 |
| 검증 | 타입 검사 · 시연 시나리오 처음부터 끝까지 실행(요청 → 순회 → 결과 입력 → 장비 고장 → 시험 종료) · 공격 재현(끊어 보내기 · 주소 자주 바꾸기 · 정상 기기 위장) · 웹 시연판을 실제 브라우저(태블릿 · 휴대폰 크기)에서 실행, 모델은 처음 보는 위치 · 세션 기준으로 평가 |

**기존 개발물 · 사전 개발 내역**: 해커톤 기간(2026. 11. 9. ~ 11. 23.) 중 새로 기획 · 개발했으며, 기존 개발물이나 타 공모전 출품작을 사용하지 않았습니다. 재사용한 것은 아래 Credits의 범용 오픈소스 라이브러리뿐입니다.

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
