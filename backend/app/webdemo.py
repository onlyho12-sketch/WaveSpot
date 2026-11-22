"""웹 시연판 어댑터: 이 현장 서버(FastAPI · AI 에이전트 · 모델 6개)를 브라우저 안 Pyodide(WebAssembly)에서 그대로 실행.

현장 구성은 그대로 '수신기 -> 현장 서버 -> 감독관 앱' 분리 구조이고, 이 파일은 심사위원이 설치 없이 링크만으로 볼 수 있게
같은 서버 코드를 브라우저 안에 띄울 때만 씀 (Vercel 정적 배포 · frontend/src/lib/demo).
 - 네트워크 대신 ASGI 호출: 화면의 /api 요청 -> http() , /api/ws -> ws_open() / ws_send() / ws_close()
 - 브라우저에는 스레드가 없으므로 FastAPI 가 동기 함수를 스레드 풀에서 돌리는 부분만 같은 이벤트 루프에서 바로 실행
 - DB(SQLite)는 브라우저 메모리에 만들어져 새로고침하면 새 교시로 시작
"""
import asyncio
import contextlib
import os
from typing import Any

os.environ.setdefault("WAVESPOT_DB_PATH", "/tmp/wavespot/wavespot.db")
os.environ.setdefault("WAVESPOT_FRONTEND_DIST", "/nonexistent")


async def _run_inline(func, *args, **kwargs):
    return func(*args, **kwargs)


@contextlib.asynccontextmanager
async def _cm_inline(cm):
    with cm as v:
        yield v


def _patch_threads() -> None:
    import fastapi.concurrency as fc
    import fastapi.dependencies.utils as fdu
    import fastapi.routing as fr
    import starlette.concurrency as sc
    import starlette.routing as sr

    for mod in (sc, fc, fr, fdu, sr):
        if hasattr(mod, "run_in_threadpool"):
            mod.run_in_threadpool = _run_inline
    for mod in (fc, fdu):
        if hasattr(mod, "contextmanager_in_threadpool"):
            mod.contextmanager_in_threadpool = _cm_inline


_patch_threads()

from app.main import app  # noqa: E402  (스레드 패치 뒤에 불러옴)

_life: Any = None
_conns: dict[int, tuple[asyncio.Queue, asyncio.Task]] = {}


async def start() -> None:
    """서버 시작 (lifespan: DB 만들기 · 엔진 준비)."""
    global _life
    _life = app.router.lifespan_context(app)
    await _life.__aenter__()


async def http(method: str, path: str, query: str, headers: list, body: bytes | None) -> dict:
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method.upper(), "scheme": "https",
        "path": path, "raw_path": path.encode(), "query_string": (query or "").encode(), "root_path": "",
        "headers": [(str(k).lower().encode("latin-1"), str(v).encode("latin-1")) for k, v in headers],
        "client": ("127.0.0.1", 0), "server": ("wavespot.local", 443),
    }
    sent = False
    out: dict[str, Any] = {"status": 500, "headers": [], "body": b""}
    chunks: list[bytes] = []

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": bytes(body or b""), "more_body": False}
        await asyncio.Future()  # 연결은 끊기지 않음

    async def send(msg):
        if msg["type"] == "http.response.start":
            out["status"] = msg["status"]
            out["headers"] = [(k.decode("latin-1"), v.decode("latin-1")) for k, v in msg.get("headers", [])]
        elif msg["type"] == "http.response.body":
            chunks.append(msg.get("body", b""))

    await app(scope, receive, send)
    out["body"] = b"".join(chunks)
    return out


def ws_open(cid: int, emit, query: str = "") -> None:
    """emit(cid, kind, value): kind = open | message | close · query: 주소의 ?token= (로그인 토큰)"""
    q: asyncio.Queue = asyncio.Queue()
    q.put_nowait({"type": "websocket.connect"})
    scope = {"type": "websocket", "asgi": {"version": "3.0"}, "scheme": "wss", "path": "/api/ws", "raw_path": b"/api/ws",
             "query_string": (query or "").encode(), "root_path": "", "headers": [], "subprotocols": [], "client": ("127.0.0.1", 0),
             "server": ("wavespot.local", 443)}

    async def receive():
        return await q.get()

    async def send(msg):
        t = msg["type"]
        if t == "websocket.accept":
            emit(cid, "open", None)
        elif t == "websocket.send":
            emit(cid, "message", msg.get("text"))
        elif t == "websocket.close":
            emit(cid, "close", msg.get("code", 1000))
            _conns.pop(cid, None)

    async def run():
        try:
            await app(scope, receive, send)
        finally:
            if cid in _conns:
                _conns.pop(cid, None)
                emit(cid, "close", 1006)

    _conns[cid] = (q, asyncio.ensure_future(run()))


def ws_send(cid: int, text: str) -> None:
    c = _conns.get(cid)
    if c:
        c[0].put_nowait({"type": "websocket.receive", "text": text})


def ws_close(cid: int) -> None:
    c = _conns.pop(cid, None)
    if c:
        c[0].put_nowait({"type": "websocket.disconnect", "code": 1000})
