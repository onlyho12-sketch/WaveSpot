"""서버 -> 감독관 앱 실시간 알림 (WebSocket). 메시지 형식: {"type": ..., "data": ...}"""
import json
from typing import Any

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def send(self, type_: str, data: Any) -> None:
        msg = json.dumps({"type": type_, "data": data}, ensure_ascii=False, default=str)
        dead = []
        for ws in self.clients:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = Hub()
