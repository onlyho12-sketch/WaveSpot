"""기기 묶기 · 주소만 바뀐 같은 기기를 하나의 '메타기기'로 잇기.

참고: Bermuda (github.com/agittins/bermuda) 의 metadevice 구조
 - 실제 기기 1대 = 메타기기, 그 아래 바뀌어 온 주소들 = 출처(metadevice_sources, 최신이 앞)
 - 출처 주소는 BLE 규격 권장 주소 수명(15분)에 맞춰 약 16분 유지 (PRUNE_TIME_KNOWN_IRK = 16 * 60)
 - Bermuda 는 IRK(암호 키)로 확정하지만 시험장의 모르는 기기는 키가 없음
   -> 설계안 v10 검증 ⑧: 사라진 주소와 새 주소의 특징(제조사 · 광고 간격 · 수신기 4대 세기 패턴) 유사도로 잇고,
      1 · 2위 차이가 0.2 미만이면 잇지 않고 보류 (잘못 연결 35 -> 3.5%, 대신 못 이음 증가)
"""
from dataclasses import dataclass, field

import numpy as np

from app.ml.sim import NODES

SOURCE_TTL = 16 * 60  # 출처 주소 유지 시간 (Bermuda PRUNE_TIME_KNOWN_IRK)
GAP_WINDOW = 30.0  # 사라진 뒤 이 시간 안에 나타난 새 주소만 후보
HOLD_MARGIN = 0.2  # 1 · 2위 유사도 차이가 이보다 작으면 보류


@dataclass
class Meta:
    meta_id: str
    sources: list[str] = field(default_factory=list)  # 최신 주소가 앞
    company: str | None = None
    interval: float | None = None
    pattern: np.ndarray | None = None  # 수신기 4대 세기 패턴 (최근 창 평균)
    last_seen: float = 0.0
    first_seen: float = 0.0


def _pattern(rssi: dict[str, float]) -> np.ndarray:
    return np.array([rssi.get(n, -100.0) for n in NODES])


def similarity(m: Meta, meta: dict, rssi: dict[str, float]) -> float:
    """0~1. 제조사가 다르면 0, 광고 간격 · 세기 패턴 차이로 감점."""
    if m.company and meta.get("company") and m.company != meta.get("company"):
        return 0.0
    s = 1.0
    if m.interval and meta.get("interval"):
        s -= min(0.5, abs(m.interval - meta["interval"]) / max(m.interval, 1) * 2)
    if m.pattern is not None:
        d = float(np.abs(m.pattern - _pattern(rssi)).mean())  # 수신기 4대 평균 세기 차 (dB)
        s -= min(0.6, d / 20)
    return max(0.0, s)


class Linker:
    def __init__(self) -> None:
        self.metas: dict[str, Meta] = {}
        self.alias: dict[str, str] = {}  # 주소 -> 메타기기

    def known(self, addr: str) -> str | None:
        return self.alias.get(addr)

    def touch(self, meta_id: str, addr: str, meta: dict, rssi: dict[str, float], t: float) -> None:
        m = self.metas.setdefault(meta_id, Meta(meta_id, first_seen=t))
        if addr not in m.sources:
            m.sources.insert(0, addr)
        self.alias[addr] = meta_id
        m.company = meta.get("company", m.company)
        m.interval = meta.get("interval", m.interval)
        p = _pattern(rssi)
        m.pattern = p if m.pattern is None else 0.7 * m.pattern + 0.3 * p
        m.last_seen = t
        m.sources = m.sources[:8]
        if len(self.metas) > 200:  # 오래 안 보인 메타기기 정리 (Bermuda 방식 수명)
            stale = [k for k, v in self.metas.items() if t - v.last_seen > SOURCE_TTL]
            for k in stale:
                for a in self.metas.pop(k).sources:
                    self.alias.pop(a, None)

    def candidates(self, addr: str, meta: dict, rssi: dict[str, float], t: float, active: set[str]) -> list[tuple[str, float]]:
        """새 주소와 이어질 수 있는 메타기기 (최근에 사라진 것만) · 유사도 높은 순."""
        out = []
        for mid, m in self.metas.items():
            if mid in active or t - m.last_seen > GAP_WINDOW or t - m.last_seen < 0:
                continue
            out.append((mid, similarity(m, meta, rssi)))
        return sorted(out, key=lambda x: -x[1])

    def decide(self, cands: list[tuple[str, float]]) -> tuple[str, str | None, float, float]:
        """('link' | 'hold' | 'new', 메타기기, 1위 유사도, 1 · 2위 차이)."""
        if not cands or cands[0][1] < 0.5:
            return "new", None, cands[0][1] if cands else 0.0, 1.0
        gap = cands[0][1] - (cands[1][1] if len(cands) > 1 else 0.0)
        return ("link" if gap >= HOLD_MARGIN else "hold"), cands[0][0], cands[0][1], gap
