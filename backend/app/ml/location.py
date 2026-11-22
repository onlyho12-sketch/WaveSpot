"""위치 모델 2개 (교실 안/밖 · 반쪽 줄 구역) + Wi-Fi 용도 모델 (모두 근거 기반 모의 데이터 학습 · v10).

수신기 1대가 끊기면 3대용 모델(빠지는 4가지 조합 미리 학습)로 자동 전환 (v11 10장).
규칙 기반 판단은 장비 · 모델 이상(수신기 2대 이상 끊김 · 모델 출력 이상 · 모델 파일 없음)일 때만 사용 (v10 '규칙으로 물러서지 않음').
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


def _load3(node: str):
    path = settings.artifacts_dir / f"loc3_{node}.joblib"
    if not path.exists():
        return None
    b = joblib.load(path)
    b["zone"].n_jobs = b["inside"].n_jobs = 1
    return b


@dataclass
class LocationResult:
    inside: bool
    p_inside: float
    inside_reason: str
    zone: int
    zone_prob: float
    zone_probs: dict[int, float]
    method: str  # "AI" | "AI 3대용" | "규칙 (장비 이상)" | "규칙 (모델 오류)"
    nodes_heard: int
    strongest: float


class Locator:
    def __init__(self) -> None:
        self.zone = _load("zone_rf.joblib")
        self.inside_m = _load("inside_rf.joblib")
        self.wifi = _load("wifi_rf.joblib")
        self.three = {n: b for n in sim.NODES if (b := _load3(n))}  # 수신기 n 이 빠졌을 때
        self.broken = False  # 모델 출력 이상 감지 중 (출력 범위 · 결측 검사) -> 규칙 점수

    def models_loaded(self) -> tuple[int, int]:
        """위치 · 용도 모델 파일 수 / 필요한 수 (4대용 위치 · 안/밖 · 용도 + 3대용 4개)."""
        n = sum(m is not None for m in (self.zone, self.inside_m, self.wifi)) + len(self.three)
        return n, 3 + len(sim.NODES)

    def locate(self, rssi: dict[str, float], nodes_ok: int = 4, down: list[str] | None = None) -> LocationResult:
        vals = np.array([[rssi.get(n, MISSING) for n in sim.NODES]])
        down = down or []
        for n in down:  # 끊긴 수신기 값은 쓰지 않음
            vals[0][sim.NODES.index(n)] = MISSING
        heard = int((vals > MISSING).sum())
        strongest = float(vals.max())
        reason = f"가장 강한 수신기 {strongest:.0f} dBm, 수신기 {heard}/4"
        if self.broken:
            return self._rule(vals[0], heard, strongest, reason, nodes_ok, "규칙 (모델 오류)")
        if nodes_ok == 3 and len(down) == 1 and down[0] in self.three:
            b = self.three[down[0]]
            zone_m, inside_m, method = b["zone"], b["inside"], "AI 3대용"
        elif self.zone is None or self.inside_m is None or nodes_ok < 4:
            return self._rule(vals[0], heard, strongest, reason, nodes_ok)
        else:
            zone_m, inside_m, method = self.zone["model"], self.inside_m["model"], "AI"
        F = location_features(vals)
        p_in = float(inside_m.predict_proba(F)[0][1])
        pz = zone_m.predict_proba(F)[0]
        if not np.all(np.isfinite(pz)) or not np.isfinite(p_in):  # 결측 · 범위 밖 출력 -> 이번 창은 규칙
            return self._rule(vals[0], heard, strongest, reason, nodes_ok, "규칙 (모델 오류)")
        probs = {int(c): float(p) for c, p in zip(zone_m.classes_, pz)}
        z = max(probs, key=probs.get)
        return LocationResult(p_in >= 0.5, p_in, reason, z, probs[z], probs, method, heard, strongest)

    def _rule(self, x, heard, strongest, reason, nodes_ok, method: str = "규칙 (장비 이상)") -> LocationResult:
        """규칙 예비 (장비 · 모델 이상 시): 세기 문턱 + 가중 중심이 속한 반쪽 줄."""
        inside = strongest >= -88 and heard >= 2
        w = np.where(x <= MISSING, 0, 10 ** (x / 20)); w = w / max(w.sum(), 1e-12)
        px = sum(w[i] * sim.NODE_XY[n][0] for i, n in enumerate(sim.NODES))
        py = sum(w[i] * sim.NODE_XY[n][1] for i, n in enumerate(sim.NODES))
        r = min(sim.ROWS - 1, max(0, int(py // sim.ROW_Y))); half = 1 if px >= sim.ROOM_W / 2 else 0
        z = r * 2 + half + 1
        return LocationResult(inside, 1.0 if inside else 0.0, reason + f", 수신기 {nodes_ok}/4 정상", z, 1.0,
                              {k: float(k == z) for k in range(1, 9)}, method, heard, strongest)

    def usage(self, feat: dict[str, float] | None) -> tuple[str, float] | None:
        """Wi-Fi 용도 (영상 통화 · 음성 통화 · 사진 전송 · 대기) 와 확률."""
        if not feat or self.wifi is None:
            return None
        p = self.wifi["model"].predict_proba(np.array([[feat[k] for k in wifi_sim.FEATS]]))[0]
        i = int(np.argmax(p))
        return str(self.wifi["model"].classes_[i]), float(p[i])
