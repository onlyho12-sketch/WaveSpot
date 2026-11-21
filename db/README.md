# db · SQLite

- `wavespot.db` : 실행 중 생성되는 DB 파일 (저장소에 올리지 않음). 지우면 다음 실행 때 새로 만들어짐
- `schema/schema.sql` : 테이블 정의 (backend/app/models.py 에서 자동 생성)

| 테이블 | 내용 |
|---|---|
| examsession | 시험(교시) · 좌석 배치 · 진행 상태 (setup → baseline → running → ended) |
| alloweddevice | 허용 목록 · 입실 전 기준선 · 수색 후 미발견으로 옮긴 신호 |
| searchrequest | 정밀 수색 요청 · 구역 1 · 2순위 · 위험 점수 · 근거 카드(JSON) · 수색 부위 · 결과 |
| agentevent | 에이전트 판단 기록 (단계: 준비 · 신호 감지 · 위치 추정 · 수색 · 결과 반영 · 장비) → 시험 후 리포트 · 이의 제기 근거 |

개인정보: 기기 주소는 수신기에서 해시한 값만 저장, 수험생 이름 대신 좌석 번호만 기록.
