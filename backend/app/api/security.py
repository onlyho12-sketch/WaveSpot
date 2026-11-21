"""역할별 권한 · 접근 기록 (설계안 v11 10장).

감독관: 담당 교실 감독 · 결과 입력 / 관리자: 설정 · 장애 재현 / 감사: 리포트 · 기록 열람만.
모든 열람 · 변경 · 내보내기를 접근 기록에 남기고, 거부된 시도(권한 없음 · 시험 중 잠금)도 남김.
프로토타입은 요청 머리글(X-WaveSpot-Role)로 역할을 받음. 실기기 단계에서 로그인 · 관리자 2단계 인증으로 바꿈.
"""
from fastapi import Request
from fastapi.responses import JSONResponse
from sqlmodel import Session

from app.core.db import engine as db
from app.models import AccessLog

ROLES = {"supervisor": "감독관", "admin": "관리자", "auditor": "감사"}
ADMIN_ONLY = ("/api/faults/", "/api/attacks/")  # 장애 · 공격 재현은 관리자만
NOT_LOGGED = ("/api/health", "/api/status", "/api/scenarios", "/api/ws")  # 화면 갱신용 (개인 기록 아님)


def role_of(request: Request) -> str:
    r = request.headers.get("x-wavespot-role", "supervisor")
    return r if r in ROLES else "supervisor"


def action_of(method: str, path: str) -> str:
    if path.endswith("/export"):
        return "내보내기"
    return "열람" if method == "GET" else "변경"


async def access_middleware(request: Request, call_next):
    path = request.url.path
    if not path.startswith("/api") or path.startswith(NOT_LOGGED) or request.method == "OPTIONS":
        return await call_next(request)
    role = role_of(request)
    if role == "auditor" and request.method != "GET":
        resp = JSONResponse({"detail": "감사 역할은 열람만 할 수 있습니다"}, 403)
    elif request.method != "GET" and path.startswith(ADMIN_ONLY) and role != "admin":
        resp = JSONResponse({"detail": "관리자만 할 수 있습니다"}, 403)
    else:
        resp = await call_next(request)
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
