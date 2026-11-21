from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.routes import exam, requests
from app.realtime.hub import hub
from app.services.engine import engine

api_router = APIRouter(prefix="/api")
api_router.include_router(exam.router)
api_router.include_router(requests.router)


@api_router.get("/health")
def health():
    return {"ok": True}


@api_router.websocket("/ws")
async def ws(websocket: WebSocket):
    await hub.connect(websocket)
    await hub.send("status", engine.status())
    try:
        while True:
            await websocket.receive_text()  # 연결 유지 (클라이언트 핑)
    except WebSocketDisconnect:
        hub.disconnect(websocket)
