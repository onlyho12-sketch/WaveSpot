"""서버 -> 감독관 앱 실시간 알림 (WebSocket). 메시지 형식: {"type": ..., "data": ...}

화면 채널(WebSocket)은 측정 채널(MQTT)과 분리: 화면이 끊겨도 판단은 계속됨 (v11 10장 '채널 분리').
앱이 끊긴 동안 놓친 알림(판단 기록 · 수색 요청) 수를 세 두었다가, 다시 연결되면 앱이 놓친 기록을 다시 받아 감.
"""
import json
import time
from typing import Any

from fastapi import WebSocket

MISSABLE = ("event", "request")  # 끊긴 동안 놓치면 다시 받아야 하는 알림


class Hub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.outage_until = 0.0  # 앱 연결 끊김 재현 (실제 시각)
        self.missed = 0

    def in_outage(self) -> bool:
        return time.monotonic() < self.outage_until

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def drop_all(self, seconds: float) -> None:
        """감독관 앱 연결 끊김 재현: 모든 화면 연결을 끊고 seconds 동안 새 연결을 받지 않음."""
        self.outage_until = time.monotonic() + seconds
        for ws in list(self.clients):
            try:
                await ws.close(code=1012)
            except Exception:
                pass
        self.clients.clear()

    async def send(self, type_: str, data: Any) -> None:
        if not self.clients:
            if type_ in MISSABLE and self.in_outage():
                self.missed += 1
            return
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
