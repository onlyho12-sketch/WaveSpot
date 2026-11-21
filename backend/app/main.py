"""WaveSpot 현장 서버 (FastAPI).

개발 실행 (backend 폴더):  .venv/Scripts/fastapi dev app/main.py
현장 실행 (Raspberry Pi):  fastapi run app/main.py   -> 프론트 빌드(frontend/dist)를 같은 주소에서 제공, 외부 인터넷 불필요
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.main import api_router
from app.core.config import settings
from app.core.db import init_db
from app.services.engine import lifespan_engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    async with lifespan_engine():
        yield


app = FastAPI(title="WaveSpot", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(api_router)

dist = settings.frontend_dist
if (dist / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = dist / path
        if path and f.is_file():
            return FileResponse(f)
        # index.html 은 캐시 금지: 새로 빌드하면 새로고침만으로 바뀐 화면이 보이도록 (assets 는 파일명에 해시가 있어 캐시해도 됨)
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})
