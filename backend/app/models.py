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
