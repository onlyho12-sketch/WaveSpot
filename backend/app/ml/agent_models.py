"""설계안 7장 'AI 모델 6개' 중 위치 · Wi-Fi 용도를 뺀 나머지 4개 (근거 기반 모의 데이터 학습 · 실측 전).

  kind_rf     기기 종류 분류  광고 간격 · 제조사         -> 이어폰 · 카메라 안경 · 휴대폰 · 스마트워치   랜덤 포레스트
  link_lr     기기 묶기       사라진 주소 vs 새 주소 특징 -> 같은 기기일 확률                          로지스틱 회귀
  score_lr    위험 점수       교실 안 · 종류 · 지속 · 새 등장 · 용도 · 우회 행동 -> 정밀 수색에서 기기가 나올 확률   로지스틱 회귀
  anomaly_if  이상 감지       교실 전체 10초 창 통계      -> 평소와 다른 구간                           Isolation Forest

모의 데이터 근거와 한계 (README · 설계안 8장에 같은 내용)
 - 종류: 공개 BLE 원본의 광고 간격(Microsoft 104 ms · Apple 274 ms)을 휴대폰 · 상시 광고 기기 기준으로 삼고,
   이어폰(폰과 끊기면 20~60 ms 재연결 광고) · 안경 · 워치 간격은 가정. 팀 기기 직접 수집 후 교체.
 - 묶기: sim.py 의 수신기 4대 세기(공개 데이터 적합 경로손실 · 인체 차폐)로 '같은 자리 기기의 주소 변경' vs '다른 기기'를 생성.
 - 위험 점수: 정밀 수색 결과 기록이 아직 없어, 설계안 9장 위험 점수 항목 배점을 사전 지식으로 삼아 발견 / 미발견을 모의 생성.
   실제 수색 결과가 쌓이면 시험 후 사람 검토를 거쳐 같은 함수로 재학습 (시험 중에는 바꾸지 않음).
 - 이상 감지: 부정행위자 없는 정상 교실(허용 기기 2~4대 · 복도 · 옆 교실 신호 · 주소 변경)만으로 학습 -> 평소와 다른 창을 찾음.
모델 파일이 없거나 '모델 오류' 재현 중이면 각 기능은 예전 규칙으로 물러섬 (근거 카드에 '규칙' 표시).
"""
import math
import warnings
from dataclasses import dataclass

import joblib
import numpy as np

from app.core.config import settings
from app.ml import sim

warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")

# ---------------- 기기 종류 ----------------
KINDS = ["earbuds", "glasses", "phone", "watch"]
COMPANIES = ["0x004C", "0x0075", "0x0006", "0x00E0", "0x01AB"]  # Apple · Samsung · Microsoft · Google · Meta (그 밖 = 기타)
KIND_FEATS = ["log_interval"] + [f"co_{c}" for c in COMPANIES] + ["co_other"]


def kind_features(meta: dict) -> list[float] | None:
    iv = meta.get("interval")
    if not iv:
        return None
    co = str(meta.get("company") or "")
    onehot = [1.0 if co == c else 0.0 for c in COMPANIES]
    return [math.log10(max(float(iv), 5.0))] + onehot + [0.0 if any(onehot) else 1.0]


# 종류별 (광고 간격 범위 ms, 확률), 제조사 확률  · 가정 (팀 기기 수집 후 교체)
KIND_SIM = {
    "earbuds": ([((20, 60), 0.7), ((60, 130), 0.3)], {"0x004C": 0.4, "0x0075": 0.3, "other": 0.3}),
    "glasses": ([((60, 200), 1.0)], {"0x01AB": 0.5, "0x00E0": 0.1, "other": 0.4}),
    "phone": ([((150, 400), 0.85), ((100, 150), 0.15)], {"0x004C": 0.45, "0x0075": 0.4, "0x00E0": 0.15}),
    "watch": ([((400, 1200), 0.8), ((250, 400), 0.2)], {"0x004C": 0.35, "0x0075": 0.4, "0x00E0": 0.25}),
}


def build_kind(rng: np.random.Generator, n_per: int = 1500):
    X, y = [], []
    others = ["0x0059", "0x0087", "0x0157", None]
    for k, (ivs, cos) in KIND_SIM.items():
        for _ in range(n_per):
            (lo, hi), _p = ivs[rng.choice(len(ivs), p=[p for _, p in ivs])]
            iv = rng.uniform(lo, hi) * rng.lognormal(0, 0.05)
            names = list(cos)
            c = names[rng.choice(len(names), p=list(cos.values()))]
            if c == "other":
                c = others[rng.integers(len(others))]
            X.append(kind_features({"interval": iv, "company": c})); y.append(k)
    return np.array(X), np.array(y)


# ---------------- 기기 묶기 ----------------
LINK_FEATS = ["same_company", "interval_diff", "pattern_mean_db", "pattern_max_db", "gap_s"]


def link_features(company_a, interval_a, pattern_a, company_b, interval_b, pattern_b, gap: float) -> list[float]:
    same = 0.5 if not company_a or not company_b else float(company_a == company_b)
    if interval_a and interval_b:
        idiff = abs(interval_a - interval_b) / max(interval_a, interval_b)
    else:
        idiff = 0.25
    if pattern_a is None:
        pm = px = 10.0
    else:
        d = np.abs(np.asarray(pattern_a, float) - np.asarray(pattern_b, float))
        pm, px = float(d.mean()), float(d.max())
    return [same, idiff, pm, px, float(gap)]


def _rand_pos(rng):
    if rng.random() < 0.8:
        x0, y0 = sim.seat_xy(int(rng.integers(1, sim.ROWS * sim.COLS + 1)))
        return x0 + rng.uniform(-0.3, 0.3), y0 + rng.uniform(-0.6, 0.6), 0.0
    return sim.outside_xy(rng)


def _ema_pattern(rng, x, y, wall, n: int):
    p = None
    for _ in range(n):
        w = sim.window(rng, x, y, wall)
        p = w if p is None else 0.7 * p + 0.3 * w
    return p


def build_link(rng: np.random.Generator, n: int = 3000):
    X, y = [], []
    ivs = [30, 45, 100, 104, 200, 274, 300, 500, 1000]
    cos = ["0x004C", "0x0075", "0x0006", "0x00E0"]
    for _ in range(n):
        x, yy, wall = _rand_pos(rng)
        co = cos[rng.integers(len(cos))]
        iv = float(ivs[rng.integers(len(ivs))])
        old = _ema_pattern(rng, x, yy, wall, int(rng.integers(2, 7)))
        gap = rng.uniform(0, 30)
        # 같은 기기 · 주소만 바뀜 (같은 자리 · 같은 제조사 · 간격 그대로)
        new = sim.window(rng, x, yy, wall)
        X.append(link_features(co, iv, old, co, iv * rng.lognormal(0, 0.03), new, gap)); y.append(1)
        # 다른 기기 (흔한 제조사 · 비슷한 간격도 섞음)
        x2, y2, w2 = _rand_pos(rng)
        co2 = co if rng.random() < 0.4 else cos[rng.integers(len(cos))]
        iv2 = iv * rng.uniform(0.9, 1.1) if rng.random() < 0.3 else float(ivs[rng.integers(len(ivs))])
        new2 = sim.window(rng, x2, y2, w2)
        X.append(link_features(co, iv, old, co2, iv2, new2, gap)); y.append(0)
    return np.array(X), np.array(y)


# ---------------- 위험 점수 ----------------
SCORE_FEATS = ["교실 안", "기기 종류", "지속", "새 등장", "통신 용도", "끊어 보내기", "접근 반응", "주소 변경", "허용 기기"]
# 설계안 9장 위험 점수 배점 (사전 지식) · 발견 / 미발견 모의 생성에만 씀, 모델은 이 값을 직접 쓰지 않음
PRIOR_POINTS = [25, 20, 20, 15, 20, 15, 15, 10, 20]


def build_score(rng: np.random.Generator, n: int = 20000):
    X = np.column_stack([
        rng.beta(2, 1.2, n),  # 교실 안 확률
        rng.choice([0.5, 0.6, 0.8, 1.0], n),  # 종류 가중
        rng.uniform(0, 1, n),  # 지속 (120초 = 1)
        rng.binomial(1, 0.6, n),  # 휴대폰 수거 뒤 새로 나타남
        np.where(rng.random(n) < 0.35, rng.uniform(0, 1, n), 0.0),  # 통신 용도 위험 x 확률
        np.where(rng.random(n) < 0.1, rng.uniform(0.3, 1, n), 0.0),  # 끊어 보내기 (3번 = 1)
        rng.binomial(1, 0.05, n),
        rng.binomial(1, 0.05, n),
        rng.binomial(1, 0.04, n),
    ])
    pts = X @ np.array(PRIOR_POINTS, float)
    p_found = 1 / (1 + np.exp(-(pts - 58) / 9))  # 근거가 많을수록 기기가 나올 가능성 (사람 판단의 흔들림 포함)
    return X, rng.binomial(1, p_found)


# ---------------- 이상 감지 ----------------
ANOM_FEATS = ["addresses", "new_addresses", "not_allowed", "same_company_max", "new_not_allowed"]


def anomaly_features(windows: dict, allowed_addr: set[str], new_addr: set[str]) -> list[float]:
    """교실 전체 10초 창 -> 이상 감지 입력. 신호 내용 · 위치가 아니라 '행동' 통계만
    (설계안 8장 v9 검증 ②: 패킷 · 주소 · 새 주소 · 제조사 번호를 바꿔 쓰는 주소). 위치 판단은 기기별 모델 몫."""
    cos: dict[str, int] = {}
    for w in windows.values():
        c = str(w["meta"].get("company"))
        cos[c] = cos.get(c, 0) + 1
    na = sum(1 for a in windows if a not in allowed_addr)
    nn = sum(1 for a in new_addr if a not in allowed_addr)
    return [len(windows), len(new_addr), na, max(cos.values()) if cos else 0, nn]


ANOM_SPAN = 3  # 최근 3개 창(30초) 특징 평균으로 판단 (설계안 '30초 연속 확인')


def build_anomaly(rng: np.random.Generator, n: int = 4000):
    """부정행위자 없는 정상 교실의 30초(10초 창 3개) 평균 특징:
    허용 기기(교탁 · 칠판 쪽 장비) + 복도 · 옆 교실 신호 + 가끔 주소 변경."""
    X = []
    for _ in range(n):
        n_allow = int(rng.integers(2, 5))
        n_out = int(rng.poisson(0.8))
        allow_xy = [(rng.uniform(0, sim.ROOM_W), rng.uniform(0, 0.8), 0.0) for _ in range(n_allow)]
        out_xy = [sim.outside_xy(rng) for _ in range(n_out)]
        cos_out = [["0x0075", "0x004C", "0x00E0", "0x0006"][int(rng.integers(4))] for _ in range(n_out)]
        span = []
        for _w in range(ANOM_SPAN):
            windows, allowed, new = {}, set(), set()
            for i, (x, y, wall) in enumerate(allow_xy):
                v = sim.window(rng, x, y, wall)
                a = f"al{i}"
                windows[a] = {"meta": {"company": ["0x0075", "0x004C", "0x00E0"][i % 3]},
                              "rssi": {n_: float(v[j]) for j, n_ in enumerate(sim.NODES) if v[j] > -100}}
                allowed.add(a)
                if rng.random() < 0.01:
                    new.add(a)
            for i, (x, y, wall) in enumerate(out_xy):
                v = sim.window(rng, x, y, wall)
                r = {n_: float(v[j]) for j, n_ in enumerate(sim.NODES) if v[j] > -100}
                if not r:
                    continue
                a = f"out{i}"
                windows[a] = {"meta": {"company": cos_out[i]}, "rssi": r}
                if rng.random() < 0.08:  # 복도 · 옆 교실 기기의 주소 변경 · 새로 지나감
                    new.add(a)
            span.append(anomaly_features(windows, allowed, new))
        X.append(np.mean(span, 0))
    return np.array(X)


# ---------------- 불러오기 · 추론 ----------------
def _load(name: str):
    p = settings.artifacts_dir / name
    if not p.exists():
        return None
    b = joblib.load(p)
    if hasattr(b["model"], "n_jobs"):
        b["model"].n_jobs = 1
    return b


@dataclass
class Kind:
    kind: str
    prob: float
    method: str  # "AI" | "규칙"


class AgentModels:
    """에이전트가 도구로 부르는 4개 모델. 위치 · Wi-Fi 용도는 Locator."""

    FILES = ("kind_rf.joblib", "link_lr.joblib", "score_lr.joblib", "anomaly_if.joblib")

    def __init__(self) -> None:
        self.kind_m, self.link_m, self.score_m, self.anom_m = (_load(f) for f in self.FILES)

    def loaded(self) -> int:
        return sum(m is not None for m in (self.kind_m, self.link_m, self.score_m, self.anom_m))

    def kind(self, meta: dict, rule) -> Kind:
        f = kind_features(meta)
        if self.kind_m is None or f is None:
            return Kind(rule(meta), 1.0, "규칙")
        m = self.kind_m["model"]
        p = m.predict_proba(np.array([f]))[0]
        i = int(np.argmax(p))
        return Kind(str(m.classes_[i]), float(p[i]), "AI")

    def link_prob(self, feats: list[float]) -> float | None:
        if self.link_m is None:
            return None
        return float(self.link_m["model"].predict_proba(np.array([feats]))[0][1])

    def score(self, x: list[float]) -> tuple[int, list[float]] | None:
        """(0~100점, 항목별 기여 점수). 기여 = 계수 x 값 (양수만) 을 점수에 비례 배분."""
        if self.score_m is None:
            return None
        m = self.score_m["model"]
        xa = np.array([x], float)
        p = float(m.predict_proba(xa)[0][1])
        score = int(round(100 * p))
        contrib = np.maximum(m.coef_[0] * xa[0], 0.0)
        tot = contrib.sum()
        pts = (contrib / tot * score).tolist() if tot > 0 else [0.0] * len(x)
        return score, pts

    def anomaly(self, feats: list[float]) -> tuple[float, float] | None:
        """(이상 점수 0~1, 기준). 클수록 평소와 다름 · 기준은 정상 교실 창의 상위 1% (IsolationForest offset)."""
        if self.anom_m is None:
            return None
        s = float(self.anom_m["model"].score_samples(np.array([feats], float))[0])
        return float(min(1.0, max(0.0, -s))), float(self.anom_m.get("threshold", 0.5))
