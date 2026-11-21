"""수신기 측정값 형식과 창 단위 집계.

MQTT 메시지 형식 (ESPresense 방식을 따름):
  토픽  wavespot/devices/{device_id}/{node_id}    예: wavespot/devices/a1b2c3/R1
  내용  {"rssi": -67, "rssiVar": 4.1, "company": "0x004C", "interval": 30, "name": null}
  토픽  wavespot/rooms/{node_id}/status           내용 "online" | "offline"
device_id 는 수신기가 MAC 주소를 해시한 값 (원본 주소는 저장하지 않음)
"""
from collections import defaultdict
from dataclasses import dataclass, field
from statistics import median
from typing import Any


@dataclass
class Reading:
    t: float  # 시험 시작 기준 초 (재생) 또는 시계 초 (실제)
    device_id: str
    node_id: str
    rssi: float
    meta: dict[str, Any] = field(default_factory=dict)


class WindowBuffer:
    """창(기본 10초) 동안 기기 · 수신기별 세기를 모아 중앙값으로 정리 (흔들림 제거)."""

    def __init__(self) -> None:
        self.rssi: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
        self.meta: dict[str, dict[str, Any]] = {}

    def add(self, r: Reading) -> None:
        self.rssi[r.device_id][r.node_id].append(r.rssi)
        if r.meta:
            self.meta.setdefault(r.device_id, {}).update(r.meta)

    def flush(self) -> dict[str, dict[str, Any]]:
        out = {
            d: {"rssi": {n: float(median(v)) for n, v in nodes.items()}, "meta": self.meta.get(d, {})}
            for d, nodes in self.rssi.items()
        }
        self.rssi.clear()
        self.meta.clear()
        return out
