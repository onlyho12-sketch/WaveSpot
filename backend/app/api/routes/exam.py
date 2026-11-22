"""시험 세션 · 장비 점검 · 기준선 · 진행 제어."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.engine import engine
from app.services.replay import SCENARIOS

router = APIRouter(tags=["exam"])


class NewSession(BaseModel):
    name: str = "컴퓨터활용능력 2급"
    date: str = Field("", pattern=r"^(\d{4}-\d{2}-\d{2})?$")  # 시험 날짜
    start: str = Field("09:00", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")  # 시작 시각
    end: str = Field("09:40", pattern=r"^([01]\d|2[0-3]):[0-5]\d$")  # 종료 시각 (같은 날)
    place: str = Field("", max_length=40)  # 시험 장소
    scenario: str = "demo"
    rows: int = 4
    cols: int = 10


class Control(BaseModel):
    action: str  # pause | resume
    speed: float | None = None


@router.get("/status")
def status():
    return engine.status()


@router.get("/scenarios")
def scenarios():
    return [{"id": k, "title": v["title"]} for k, v in SCENARIOS.items()]


@router.post("/session")
async def new_session(body: NewSession):
    mins = lambda hm: int(hm[:2]) * 60 + int(hm[3:])  # noqa: E731
    duration = mins(body.end) - mins(body.start)
    if not 10 <= duration <= 300:
        raise HTTPException(422, "종료 시각은 시작 시각보다 10분 이상, 5시간 이내로 늦어야 합니다.")
    engine.new_session(body.name, body.scenario, body.rows, body.cols, body.date, body.start, body.place.strip(), duration)
    await engine.broadcast_status()
    return engine.status()


@router.post("/session/baseline")
async def baseline():
    added = await engine.baseline()
    return {"added": added, **engine.status()}


@router.post("/session/start")
async def start():
    if engine.session and engine.session.state == "baseline" and not engine.selfcheck_ok():
        bad = [c["label"] for c in engine.selfcheck() if c["ok"] is False]
        raise HTTPException(409, f"자가 점검을 통과하지 못했습니다: {', '.join(bad)}")
    engine.start()
    await engine.broadcast_status()
    return engine.status()


@router.post("/session/control")
async def control(body: Control):
    if body.action == "pause":
        engine.paused = True
    elif body.action == "resume":
        engine.paused = False
    if body.speed:
        engine.speed = max(0.5, min(body.speed, 60))
    await engine.broadcast_status()
    return engine.status()
