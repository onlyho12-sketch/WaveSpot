from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.routes import exam, requests, system
from app.realtime.hub import hub
from app.services.engine import engine

api_router = APIRouter(prefix="/api")
api_router.include_router(exam.router)
api_router.include_router(requests.router)
api_router.include_router(system.router)


@api_router.get("/health")
def health():
    return {"ok": True}


@api_router.websocket("/ws")
async def ws(websocket: WebSocket):
    if hub.in_outage():  # 앱 연결 끊김 재현 중: 연결을 받지 않음 -> 앱은 1.5초마다 다시 시도
        await websocket.close(code=1013)
        return
    await hub.connect(websocket)
    await hub.send("status", engine.status())
    if hub.missed:
        await websocket.send_json({"type": "resync", "data": {"missed": hub.missed}})
        hub.missed = 0
    try:
        while True:
            await websocket.receive_text()  # 연결 유지 (클라이언트 핑)
    except WebSocketDisconnect:
        hub.disconnect(websocket)
