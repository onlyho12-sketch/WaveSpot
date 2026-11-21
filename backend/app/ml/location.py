"""위치 모델 2개 (교실 안/밖 · 반쪽 줄 구역) + Wi-Fi 용도 모델 (모두 근거 기반 모의 데이터 학습 · v10).

규칙 기반 판단은 장비 이상(수신기 3/4 이하)이나 모델 파일이 없을 때만 사용 (v10 '규칙으로 물러서지 않음').
"""
import warnings
from dataclasses import dataclass

import joblib
import numpy as np

from app.core.config import settings
from app.ml import sim, wifi_sim
from app.ml.features import MISSING, location_features

warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")


def _load(name: str):
    path = settings.artifacts_dir / name
    if not path.exists():
        return None
    b = joblib.load(path)
    b["model"].n_jobs = 1  # 실시간 판단: 창마다 병렬 작업자를 띄우지 않음
    return b


@dataclass
class LocationResult:
    inside: bool
    p_inside: float
    inside_reason: str
    zone: int
    zone_prob: float
    zone_probs: dict[int, float]
    method: str  # "AI" | "규칙 (장비 이상)"
    nodes_heard: int
    strongest: float


class Locator:
    def __init__(self) -> None:
        self.zone = _load("zone_rf.joblib")
        self.inside_m = _load("inside_rf.joblib")
        self.wifi = _load("wifi_rf.joblib")

    def locate(self, rssi: dict[str, float], nodes_ok: int = 4) -> LocationResult:
        vals = np.array([[rssi.get(n, MISSING) for n in sim.NODES]])
        heard = int((vals > MISSING).sum())
        strongest = float(vals.max())
        reason = f"가장 강한 수신기 {strongest:.0f} dBm · 수신기 {heard}/4"
        if self.zone is None or self.inside_m is None or nodes_ok < 4:
            return self._rule(vals[0], heard, strongest, reason, nodes_ok)
        F = location_features(vals)
        p_in = float(self.inside_m["model"].predict_proba(F)[0][1])
        pz = self.zone["model"].predict_proba(F)[0]
        probs = {int(c): float(p) for c, p in zip(self.zone["model"].classes_, pz)}
        z = max(probs, key=probs.get)
        return LocationResult(p_in >= 0.5, p_in, reason, z, probs[z], probs, "AI", heard, strongest)

    def _rule(self, x, heard, strongest, reason, nodes_ok) -> LocationResult:
        """규칙 예비 (장비 이상 시): 세기 문턱 + 가중 중심이 속한 반쪽 줄."""
        inside = strongest >= -88 and heard >= 2
        w = np.where(x <= MISSING, 0, 10 ** (x / 20)); w = w / max(w.sum(), 1e-12)
        px = sum(w[i] * sim.NODE_XY[n][0] for i, n in enumerate(sim.NODES))
        py = sum(w[i] * sim.NODE_XY[n][1] for i, n in enumerate(sim.NODES))
        r = min(sim.ROWS - 1, max(0, int(py // sim.ROW_Y))); half = 1 if px >= sim.ROOM_W / 2 else 0
        z = r * 2 + half + 1
        return LocationResult(inside, 1.0 if inside else 0.0, reason + f" · 수신기 {nodes_ok}/4 정상", z, 1.0,
                              {k: float(k == z) for k in range(1, 9)}, "규칙 (장비 이상)", heard, strongest)

    def usage(self, feat: dict[str, float] | None) -> tuple[str, float] | None:
        """Wi-Fi 용도 (영상 통화 · 음성 통화 · 사진 전송 · 대기) 와 확률."""
        if not feat or self.wifi is None:
            return None
        p = self.wifi["model"].predict_proba(np.array([[feat[k] for k in wifi_sim.FEATS]]))[0]
        i = int(np.argmax(p))
        return str(self.wifi["model"].classes_[i]), float(p[i])
