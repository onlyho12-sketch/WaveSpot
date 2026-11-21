"""장애 · 복구 기록 · 장애 재현 · 우회 · 해킹 재현 · 해시 체인 확인 · 접근 기록 · 리포트 내보내기 (설계안 v11 10장)."""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlmodel import Session, select

from app.agent.agent import clock
from app.api.security import ROLES, role_of
from app.core.config import settings
from app.core.db import get_session
from app.models import AccessLog, AgentEvent, FaultRecord, SearchRequest, SupervisorNote
from app.services import integrity
from app.services.attacks import CATALOG as ATTACKS
from app.services.attacks import catalog as attack_catalog
from app.services.engine import engine
from app.services.faults import CATALOG, catalog

router = APIRouter(tags=["system"])


@router.get("/attacks")
def attacks(request: Request):
    """우회 · 해킹 대응 표 + 재현 · 탐지 기록. 이번 교시에 흔든 기준값은 관리자에게만 보여 줌."""
    _sid()
    agent = engine.agent
    admin = role_of(request) == "admin"
    return {
        "catalog": attack_catalog(),
        "runs": engine.attack_runs(),
        "can_inject": settings.source == "replay" and engine.session.state == "running",
        "rejected": engine.rejected,
        "thresholds": {"request": agent.req_score, "caution": agent.caution_score, "base_request": settings.request_score,
                       "base_caution": settings.caution_score} if admin and agent else None,
        "fingerprints": len(agent.fp) if agent else 0,
    }


@router.post("/attacks/{kind}")
async def inject_attack(kind: str):
    """우회 · 해킹 재현 (관리자 · 재생 모드 · 시험 중). 설계안 20장 실험 8."""
    if kind not in ATTACKS or not ATTACKS[kind].replay:
        raise HTTPException(404, "재현할 수 없는 항목입니다")
    if settings.source != "replay":
        raise HTTPException(409, "실제 수신기 모드에서는 재현할 수 없습니다")
    if not engine.session or engine.session.state != "running":
        raise HTTPException(409, "시험 중에만 재현할 수 있습니다")
    await engine.inject_attack(kind)
    return {"runs": engine.attack_runs()}


def _sid() -> int:
    if engine.session is None:
        raise HTTPException(409, "진행 중인 시험이 없습니다")
    return engine.session.id


def _start() -> str:
    return engine.session.exam_start_label if engine.session else "09:00"


def _fault_rows(s: Session, sid: int) -> list[dict]:
    rows = s.exec(select(FaultRecord).where(FaultRecord.session_id == sid).order_by(FaultRecord.id)).all()
    st = _start()
    return [{**f.model_dump(mode="json"), "clock": clock(max(f.started, 0), st),
             "end_clock": clock(max(f.ended, 0), st) if f.ended is not None else None,
             "target": CATALOG[f.kind].target if f.kind in CATALOG else None} for f in rows]


@router.get("/faults")
def faults(s: Session = Depends(get_session)):
    """장애 대응 표 + 이번 교시 장애 · 복구 기록 (시간순)."""
    return {"catalog": catalog(), "records": _fault_rows(s, _sid()), "can_inject": settings.source == "replay"}


@router.post("/faults/{kind}")
async def inject(kind: str):
    """장애 재현 (관리자 · 재생 모드 · 시험 중). 검증 실험 7."""
    if kind not in CATALOG:
        raise HTTPException(404, "모르는 장애 종류입니다")
    if settings.source != "replay":
        raise HTTPException(409, "실제 수신기 모드에서는 재현할 수 없습니다")
    if not engine.session or engine.session.state != "running":
        raise HTTPException(409, "시험 중에만 재현할 수 있습니다")
    await engine.inject(kind)
    return engine.status()


@router.get("/chain/verify")
def verify(s: Session = Depends(get_session)):
    """해시 체인 다시 계산 · 마지막 값 (감독관 확인서에 적는 값)."""
    return integrity.verify(s, _sid())


@router.get("/access")
def access(request: Request, limit: int = 100, s: Session = Depends(get_session)):
    """접근 기록 (관리자 · 감사만)."""
    if role_of(request) not in ("admin", "auditor"):
        return JSONResponse({"detail": "접근 기록은 관리자 · 감사 역할만 볼 수 있습니다"}, 403)
    rows = s.exec(select(AccessLog).order_by(AccessLog.id.desc()).limit(min(limit, 500))).all()
    return [{**r.model_dump(mode="json"), "role_name": ROLES.get(r.role, r.role)} for r in rows]


@router.get("/report/export")
def export(s: Session = Depends(get_session)):
    """시험 후 리포트 내보내기 (JSON): 수색 내역 · 판단 기록 · 감독관 의견 · 장애 · 복구 기록 · 해시 체인 확인 결과."""
    sid = _sid()
    st = _start()
    sess = engine.session
    body = {
        "exam": {"name": sess.name, "start": st, "duration_min": sess.duration_min, "state": sess.state},
        "chain": integrity.verify(s, sid),
        "requests": [r.model_dump(mode="json") for r in s.exec(select(SearchRequest).where(SearchRequest.session_id == sid).order_by(SearchRequest.id))],
        "events": [{**e.model_dump(mode="json"), "clock": clock(e.sim_time, st)}
                   for e in s.exec(select(AgentEvent).where(AgentEvent.session_id == sid).order_by(AgentEvent.id))],
        "notes": [n.model_dump(mode="json") for n in s.exec(select(SupervisorNote).where(SupervisorNote.session_id == sid).order_by(SupervisorNote.id))],
        "faults": _fault_rows(s, sid),
        "privacy": "기기 주소는 수신기에서 해시한 값 · 수험생 이름 대신 좌석 번호 · 통신 내용은 수집하지 않음",
    }
    return JSONResponse(body, headers={"Content-Disposition": f'attachment; filename="wavespot_report_{sid}.json"'})
