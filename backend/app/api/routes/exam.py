"""시험 세션 · 장비 점검 · 기준선 · 진행 제어."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.engine import engine
from app.services.replay import SCENARIOS

router = APIRouter(tags=["exam"])


class NewSession(BaseModel):
    name: str = "3교시 수학"
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
    engine.new_session(body.name, body.scenario, body.rows, body.cols)
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
