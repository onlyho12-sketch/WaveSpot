from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api import auth
from app.api.routes import exam, requests, system
from app.api.security import ROLES, role_of
from app.realtime.hub import hub
from app.services.engine import engine

api_router = APIRouter(prefix="/api")
api_router.include_router(exam.router)
api_router.include_router(requests.router)
api_router.include_router(system.router)


@api_router.get("/health")
def health():
    return {"ok": True}


class LoginBody(BaseModel):
    username: str
    password: str


@api_router.post("/login")
def login(body: LoginBody, request: Request):
    """아이디 · 비밀번호 확인 -> 토큰 (역할은 계정으로 정해짐)."""
    user = body.username.strip().lower()
    role = auth.check_password(user, body.password)
    if not role:
        return JSONResponse({"detail": "아이디 또는 비밀번호가 맞지 않습니다"}, 401)
    request.state.login_role = role  # 접근 기록에 이 계정으로 남김
    return {"token": auth.issue(user), "user": user, "role": role, "role_name": ROLES[role]}


@api_router.get("/me")
def me(request: Request):
    role = role_of(request)
    return {"role": role, "role_name": ROLES.get(role, role)}


@api_router.websocket("/ws")
async def ws(websocket: WebSocket):
    # 브라우저 웹소켓은 머리글을 못 붙이므로 토큰은 주소의 ?token= 으로 받음 · 없거나 틀리면 4401 (화면은 로그인으로)
    if not auth.verify(websocket.query_params.get("token")):
        await websocket.accept()  # 받은 뒤 닫아야 브라우저가 4401 코드를 받음 (받기 전에 닫으면 1006)
        await websocket.close(code=4401)
        return
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
