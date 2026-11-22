"""역할별 권한 · 접근 기록 (설계안 v11 10장).

감독관: 담당 교실 감독 · 순회 · 결과 · 의견 입력 / 관리자: 설정 · 장애 재현 (감독 화면은 보기만) / 검토자: 리포트 · 기록 열람만.
역할은 로그인 토큰(Authorization: Bearer)으로만 정함 (화면이 보내는 역할 이름은 믿지 않음 · auth.py).
모든 열람 · 변경 · 내보내기를 접근 기록에 남기고, 거부된 시도(로그인 없음 · 권한 없음 · 시험 중 잠금)도 남김.
"""
from fastapi import Request
from fastapi.responses import JSONResponse
from sqlmodel import Session

from app.api import auth
from app.core.db import engine as db
from app.models import AccessLog

ROLES = {"supervisor": "감독관", "admin": "관리자", "auditor": "검토자", "guest": "로그인 안 함"}
ADMIN_ONLY = ("/api/faults/", "/api/attacks/")  # 장애 · 공격 재현은 관리자만
# 판정 기록(순회 · 수색 결과 · 감독관 의견)은 감독관만: 기록을 만드는 사람과 시스템을 바꾸는 사람을 나눔
SUPERVISOR_ONLY = ("/api/requests/", "/api/notes")
PUBLIC = ("/api/health", "/api/login")  # 로그인 없이 부를 수 있음
NOT_LOGGED = ("/api/health", "/api/status", "/api/scenarios", "/api/ws", "/api/me")  # 화면 갱신용 (개인 기록 아님)


def token_of(request: Request) -> str | None:
    h = request.headers.get("authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else None


def role_of(request: Request) -> str:
    """로그인한 역할 · 없으면 'guest' (미들웨어가 request.state 에 넣어 둠)."""
    r = getattr(request.state, "role", None)
    return r if r else (auth.verify(token_of(request)) or "guest")


def action_of(method: str, path: str) -> str:
    if path == "/api/login":
        return "로그인"
    if path.endswith("/export"):
        return "내보내기"
    return "열람" if method == "GET" else "변경"


async def access_middleware(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api") or request.method == "OPTIONS":
        return await call_next(request)
    role = auth.verify(token_of(request)) or "guest"
    request.state.role = role
    if role == "guest" and not path.startswith(PUBLIC):
        resp = JSONResponse({"detail": "로그인이 필요합니다"}, 401)
    elif role == "auditor" and request.method != "GET":
        resp = JSONResponse({"detail": "검토자 역할은 열람만 할 수 있습니다"}, 403)
    elif request.method != "GET" and path.startswith(ADMIN_ONLY) and role != "admin":
        resp = JSONResponse({"detail": "관리자만 할 수 있습니다"}, 403)
    elif request.method != "GET" and path.startswith(SUPERVISOR_ONLY) and role != "supervisor":
        resp = JSONResponse({"detail": "순회, 수색 결과, 감독관 의견은 감독관만 입력할 수 있습니다"}, 403)
    else:
        resp = await call_next(request)
    if path.startswith(NOT_LOGGED) and resp.status_code < 400:
        return resp
    if path == "/api/login":  # 로그인 시도는 성공하면 그 계정, 실패하면 guest 로 기록
        role = getattr(request.state, "login_role", None) or "guest"
    from app.services.engine import engine  # 순환 import 방지

    try:
        with Session(db) as s:
            s.add(AccessLog(session_id=engine.session.id if engine.session else None, role=role, method=request.method,
                            path=path, action=action_of(request.method, path), status=resp.status_code,
                            allowed=resp.status_code not in (401, 403, 423)))
            s.commit()
    except Exception:  # 기록 실패가 화면 동작을 막지 않음
        pass
    return resp
