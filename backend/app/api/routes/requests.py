"""정밀 수색 요청 · 근거 카드 · 결과 입력 · 에이전트 기록."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from app.agent.agent import clock
from app.core.db import get_session
from app.models import AgentEvent, SearchRequest, SupervisorNote
from app.services.engine import engine

router = APIRouter(tags=["requests"])


class NoteIn(BaseModel):
    text: str


class StartIn(BaseModel):
    zones: list[int] | None = None  # 순회 경로 (구역 순서)
    dwell: int = 2  # 좌석당 머무는 초 (1~5)


class AllowIn(BaseModel):
    device_id: str
    label: str = "감독관 등록"


class Result(BaseModel):
    found: bool
    seat: int | None = None
    note: str | None = None


def _sid() -> int:
    if engine.session is None:
        raise HTTPException(409, "진행 중인 시험이 없습니다")
    return engine.session.id


@router.get("/requests")
def list_requests(s: Session = Depends(get_session)):
    return s.exec(select(SearchRequest).where(SearchRequest.session_id == _sid()).order_by(SearchRequest.id.desc())).all()


@router.get("/requests/{rid}")
def get_request(rid: int, s: Session = Depends(get_session)):
    req = s.get(SearchRequest, rid)
    if not req:
        raise HTTPException(404, "요청을 찾을 수 없습니다")
    return req


@router.post("/requests/{rid}/start")
async def start_search(rid: int, again: bool = False, body: StartIn | None = None, s: Session = Depends(get_session)):
    """again=true: 이미 순회한 요청도 휴대형 순회를 다시 함 (감독관이 다시 돌아보고 싶을 때)
    body.zones: 감독관이 정한 순회 경로 · body.dwell: 좌석당 머무는 초"""
    req = s.get(SearchRequest, rid)
    if not req:
        raise HTTPException(404, "요청을 찾을 수 없습니다")
    if req.state == "open":
        req.state = "searching"
        s.add(req)
        s.commit()
        s.refresh(req)
        await engine.start_search(req, again, body.zones if body else None, max(1, min(body.dwell, 5)) if body else 2)
    return req


@router.post("/requests/{rid}/result")
async def submit_result(rid: int, body: Result, s: Session = Depends(get_session)):
    req = s.get(SearchRequest, rid)
    if not req:
        raise HTTPException(404, "요청을 찾을 수 없습니다")
    if req.state in ("found", "not_found", "unresolved"):
        raise HTTPException(409, "이미 결과가 입력된 요청입니다")
    req.found_seat, req.note, req.resolved_at = body.seat, body.note, datetime.now(timezone.utc)
    s.add(req)
    s.commit()
    s.refresh(req)
    return await engine.resolve(req, body.found)


@router.get("/events")
def events(limit: int = 200, s: Session = Depends(get_session)):
    rows = s.exec(select(AgentEvent).where(AgentEvent.session_id == _sid()).order_by(AgentEvent.id.desc()).limit(limit)).all()
    start = engine.session.exam_start_label if engine.session else "09:00"
    return [{**e.model_dump(mode="json"), "clock": clock(e.sim_time, start)} for e in rows]


@router.get("/devices")
def devices():
    return engine.agent.snapshot() if engine.agent else []


@router.get("/notes")
def list_notes(s: Session = Depends(get_session)):
    rows = s.exec(select(SupervisorNote).where(SupervisorNote.session_id == _sid()).order_by(SupervisorNote.id.desc())).all()
    start = engine.session.exam_start_label if engine.session else "09:00"
    return [{**n.model_dump(mode="json"), "clock": clock(max(n.sim_time, 0), start) if n.sim_time >= 0 else "시작 전"} for n in rows]


@router.post("/notes")
def add_note(body: NoteIn, s: Session = Depends(get_session)):
    text = body.text.strip()
    if not text:
        raise HTTPException(422, "내용을 입력하세요")
    note = SupervisorNote(session_id=_sid(), sim_time=engine.t, text=text[:500])
    s.add(note)
    s.commit()
    s.refresh(note)
    start = engine.session.exam_start_label if engine.session else "09:00"
    return {**note.model_dump(mode="json"), "clock": clock(max(note.sim_time, 0), start) if note.sim_time >= 0 else "시작 전"}


@router.post("/allowlist")
async def add_allow(body: AllowIn):
    """감독관이 기기를 허용 목록에 추가 (감독관 폰 · 시험장 장비). 열린 수색 요청은 '허용 등록'으로 닫힘."""
    _sid()
    if engine.agent is None:
        raise HTTPException(409, "진행 중인 시험이 없습니다")
    closed = await engine.allow_device(body.device_id, body.label.strip() or "감독관 등록")
    return {"closed": [r.id for r in closed], **engine.status()}
