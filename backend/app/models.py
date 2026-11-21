"""DB 테이블 (SQLite · SQLModel). 스키마 설명은 db/schema/README.md."""
from datetime import datetime, timezone
from typing import Any

from sqlmodel import JSON, Column, Field, SQLModel


class ExamSession(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str
    rows: int = 4
    cols: int = 10
    state: str = "setup"  # setup -> baseline -> running -> ended
    scenario: str = "demo"
    exam_start_label: str = "09:00"
    duration_min: int = 100
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AllowedDevice(SQLModel, table=True):
    """허용 목록 (입실 전 기준선 · 감독관 등록 · 수색 후 제외)."""
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(index=True)
    device_id: str
    label: str
    reason: str  # baseline | manual | not_found


class SearchRequest(SQLModel, table=True):
    """정밀 수색 요청 + 근거 카드."""
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(index=True)
    device_id: str
    level: int = 2  # 수색 강화 사다리 Lv2 휴대형 접근 · Lv3 정밀 수색 · Lv4 2차 수색
    zone: int
    zone_prob: float = 0.0
    zone2: int | None = None
    zone2_prob: float | None = None
    seats: list[int] = Field(sa_column=Column(JSON))
    score: int
    kind: str
    state: str = "open"  # open -> searching -> (Lv3/4) open -> found | not_found | unresolved | allowed(감독관 허용 등록)
    evidence: list[dict[str, Any]] = Field(sa_column=Column(JSON))
    counter: list[str] = Field(default_factory=list, sa_column=Column(JSON))  # 반대 근거 (틀릴 수 있는 이유)
    search_parts: list[str] = Field(sa_column=Column(JSON))
    suspect_seat: int | None = None  # 휴대형 순회로 고른 좌석 (Lv3 의심 부정행위자)
    walk: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))
    sim_time: float
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    resolved_at: datetime | None = None
    found_seat: int | None = None
    note: str | None = None


class AgentEvent(SQLModel, table=True):
    """에이전트 판단 기록 (시험 후 리포트 · 이의 제기 근거)."""
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(index=True)
    sim_time: float
    device_id: str | None = None
    stage: str  # 준비 | 신호 감지 | 위치 추정 | 수색 | 결과 반영 | 장비
    level: str = "info"  # info | caution | alert | done
    message: str
    data: dict[str, Any] | None = Field(default=None, sa_column=Column(JSON))


class SupervisorNote(SQLModel, table=True):
    """감독관 의견 · 메모. 시험 후 사후 검증 기록으로 보관."""
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(index=True)
    sim_time: float  # 쓴 시점 (시험 시작 기준 초, 시작 전이면 음수)
    text: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FaultRecord(SQLModel, table=True):
    """장애 · 복구 기록 (설계안 v11 10장). 사후 리포트에 시간순으로 넣어 '그 시각 장비가 정상이었는가'를 설명."""
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(index=True)
    kind: str  # node1 | node2 | server | model | app | network | beacon | clock | result
    title: str
    action: str  # 자동 대응
    started: float  # 시험 시작 기준 초
    ended: float | None = None
    target_sec: float | None = None  # 복구 목표 (없으면 '재연결 즉시' 등 문장 목표)
    missed: int = 0  # 그동안 실시간 판단에 못 쓴 측정값 수 (수신기 자체 저장 · 재전송분)
    recover_sec: float | None = None  # 실제 복구에 걸린 초 (앱 연결은 실제 시각, 나머지는 시험 시각)
    injected: bool = False  # 관리 화면에서 재현한 장애 (검증 실험 7)


class ChainEntry(SQLModel, table=True):
    """추가만 되는 기록 + 해시 체인 (증거 신뢰성). hash = sha256(prev_hash + body_hash)."""
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(index=True)
    seq: int  # 시험(교시)마다 1부터
    kind: str  # event | result | note
    ref_id: int  # agentevent · searchrequest · supervisornote 의 id
    body: dict[str, Any] = Field(sa_column=Column(JSON))  # 기록 시점의 내용 (결과는 이후 바뀌므로 그때 값 보관)
    body_hash: str
    prev_hash: str
    hash: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AccessLog(SQLModel, table=True):
    """열람 · 변경 · 내보내기 기록 (역할별 권한). 거부된 시도도 남김."""
    id: int | None = Field(default=None, primary_key=True)
    session_id: int | None = Field(default=None, index=True)
    at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    role: str  # supervisor | admin | auditor
    method: str
    path: str
    action: str  # 열람 | 변경 | 내보내기
    status: int
    allowed: bool


class AttackRun(SQLModel, table=True):
    """우회 · 해킹 재현과 탐지 기록 (설계안 20장 실험 8: 탐지율 · 경보 여부 · 사다리 단계 변화)."""
    id: int | None = Field(default=None, primary_key=True)
    session_id: int = Field(index=True)
    kind: str  # services/attacks.py CATALOG
    title: str
    injected: bool = True  # False = 재현 없이 실제로 탐지된 것
    started: float  # 시험 시작 기준 초
    detected_at: float | None = None
    detail: str | None = None
    device_id: str | None = None  # 탐지된 메타기기 (사다리 단계를 따라가기 위해)
