"""모델 학습 · 근거 기반 모의 데이터 (설계안 v10 · 실측 전).

  zone_rf   : 반쪽 줄 8구역 (설치형 4대 세기, app/ml/sim.py 모의)
  inside_rf : 교실 안 / 밖 (교실 좌석 vs 복도 · 옆 교실, 같은 모의)
  wifi_rf   : Wi-Fi 용도 4종 (app/ml/wifi_sim.py · 논문 수치 기반 모의)
  loc3_R*   : 수신기 1대가 빠졌을 때 쓰는 3대용 위치 · 안/밖 모델 (빠지는 4가지 조합, 설계안 v11 10장)
  kind_rf · link_lr · score_lr · anomaly_if : 기기 종류 · 기기 묶기 · 위험 점수 · 이상 감지 (app/ml/agent_models.py)
실측(우리 교실 기준점 10곳 · 팀 기기 · 용도 재현)을 하면 같은 함수로 교체 학습.
실행: backend 폴더에서  .venv/Scripts/python -m app.ml.train_models   (3대용만: ... three · 에이전트 모델 4개만: ... agent)
"""
import json
import os
import sys

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

from app.core.config import settings
from app.ml import agent_models as am, sim, wifi_sim
from app.ml.features import location_features, zone_of_seat


# 웹 시연(브라우저 안 Pyodide)용: 나무 수를 줄이고 압축해 내려받기 크기를 줄임 (WAVESPOT_MODEL_SIZE=web)
WEB = os.environ.get("WAVESPOT_MODEL_SIZE") == "web"


def _n(n: int) -> int:
    return max(25, n // 4) if WEB else n


def _dump(obj, path) -> None:
    joblib.dump(obj, path, compress=3 if WEB else 0)


def build_location(rng, per_seat: int = 120, outside_n: int = 3000):
    X, zone, inside = [], [], []
    for seat in range(1, sim.ROWS * sim.COLS + 1):
        x0, y0 = sim.seat_xy(seat)
        for _ in range(per_seat):
            # 좌석 안에서 기기 위치가 조금씩 다름 (가방 · 책상 · 주머니)
            X.append(sim.window(rng, x0 + rng.uniform(-0.3, 0.3), y0 + rng.uniform(-0.6, 0.6)))
            zone.append(zone_of_seat(seat)); inside.append(1)
    Xo = []
    for _ in range(outside_n):
        x, y, wall = sim.outside_xy(rng)
        Xo.append(sim.window(rng, x, y, wall))
    return np.array(X), np.array(zone), np.array(Xo)


def build_wifi(rng, sessions: int = 12, T: float = 120.0, W: float = 10.0):
    rows, labels, groups = [], [], []
    for c in wifi_sim.CLASSES:
        for s in range(sessions):
            ev = wifi_sim.GEN[c](rng, T); loss = rng.uniform(0, 0.4)
            for t0 in np.arange(0, T - W + 1e-9, W):
                f = wifi_sim.features(rng, ev, t0, W, loss)
                rows.append([f[k] for k in wifi_sim.FEATS]); labels.append(c); groups.append(f"{c}_{s}")
    return np.array(rows), np.array(labels), np.array(groups)


def holdout(model_fn, X, y, groups=None, rng=None):
    """처음 보는 세션 · 위치로 평가 (그룹 20% 제외)."""
    if groups is None:
        idx = rng.permutation(len(y)); cut = int(len(y) * 0.8)
        tr, te = idx[:cut], idx[cut:]
    else:
        g = np.unique(groups); rng.shuffle(g); test_g = set(g[: max(1, len(g) // 5)])
        te = np.array([x in test_g for x in groups]); tr = ~te
    m = model_fn().fit(X[tr], y[tr])
    return float((m.predict(X[te]) == y[te]).mean())


def main() -> None:
    rng = np.random.default_rng(2026)
    out = settings.artifacts_dir
    out.mkdir(parents=True, exist_ok=True)
    rf = lambda: RandomForestClassifier(n_estimators=_n(120), max_depth=14, min_samples_leaf=5, n_jobs=-1, random_state=0)

    X, zone, Xo = build_location(rng)
    F_in = location_features(X); F_out = location_features(Xo)
    acc_zone = holdout(rf, F_in, zone, rng=rng)
    Fi = np.vstack([F_in, F_out]); yi = np.r_[np.ones(len(F_in)), np.zeros(len(F_out))].astype(int)
    acc_inside = holdout(rf, Fi, yi, rng=rng)
    _dump({"model": rf().fit(F_in, zone), "kind": "zone"}, out / "zone_rf.joblib")
    _dump({"model": rf().fit(Fi, yi), "kind": "inside"}, out / "inside_rf.joblib")

    Xw, yw, gw = build_wifi(rng)
    acc_wifi = holdout(lambda: RandomForestClassifier(_n(300), min_samples_leaf=2, random_state=0, n_jobs=-1), Xw, yw, gw, rng)
    _dump({"model": RandomForestClassifier(_n(300), min_samples_leaf=2, random_state=0, n_jobs=-1).fit(Xw, yw),
                 "feats": wifi_sim.FEATS}, out / "wifi_rf.joblib")

    report = {"data": "근거 기반 모의 (실측 아님)", "zone_8_accuracy": round(acc_zone, 3),
              "inside_accuracy": round(acc_inside, 3), "wifi_usage_accuracy_10s": round(acc_wifi, 3)}
    report.update(train_three(X, zone, Xo, rng))
    report.update(train_agent(rng))
    (out / "train_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(report)


def train_three(X=None, zone=None, Xo=None, rng=None) -> dict:
    """수신기 1대가 끊겼을 때 쓰는 3대용 모델: 그 수신기 값을 '안 들림'으로 지우고 학습 (4가지 조합)."""
    from app.ml.features import MISSING

    rng = rng if rng is not None else np.random.default_rng(2027)
    if X is None:
        X, zone, Xo = build_location(rng, per_seat=80, outside_n=2000)
    rf = lambda: RandomForestClassifier(n_estimators=_n(80), max_depth=12, min_samples_leaf=5, n_jobs=-1, random_state=0)
    acc = {}
    for i, node in enumerate(sim.NODES):
        Xi, Xoi = X.copy(), Xo.copy()
        Xi[:, i] = MISSING
        Xoi[:, i] = MISSING
        F_in, F_out = location_features(Xi), location_features(Xoi)
        Fi = np.vstack([F_in, F_out]); yi = np.r_[np.ones(len(F_in)), np.zeros(len(F_out))].astype(int)
        acc[node] = round(holdout(rf, F_in, zone, rng=rng), 3)
        _dump({"zone": rf().fit(F_in, zone), "inside": rf().fit(Fi, yi), "without": node},
                    settings.artifacts_dir / f"loc3_{node}.joblib")
    return {"zone_8_accuracy_3nodes": acc}


def train_agent(rng=None) -> dict:
    """설계안 7장 모델 6개 중 나머지 4개: 기기 종류 · 기기 묶기 · 위험 점수 · 이상 감지 (근거 기반 모의)."""
    rng = rng if rng is not None else np.random.default_rng(2028)
    out = settings.artifacts_dir
    out.mkdir(parents=True, exist_ok=True)
    rep: dict = {}

    Xk, yk = am.build_kind(rng)
    kind_rf = lambda: RandomForestClassifier(n_estimators=_n(100), max_depth=10, min_samples_leaf=3, n_jobs=-1, random_state=0)
    rep["kind_accuracy"] = round(holdout(kind_rf, Xk, yk, rng=rng), 3)
    _dump({"model": kind_rf().fit(Xk, yk), "feats": am.KIND_FEATS}, out / "kind_rf.joblib")

    Xl, yl = am.build_link(rng)
    lr = lambda: LogisticRegression(max_iter=2000, C=1.0)
    idx = rng.permutation(len(yl)); cut = int(len(yl) * 0.8)
    m = lr().fit(Xl[idx[:cut]], yl[idx[:cut]])
    p = m.predict_proba(Xl[idx[cut:]])[:, 1]; yt = yl[idx[cut:]]
    rep["link_same_device_found"] = round(float((p[yt == 1] >= 0.5).mean()), 3)
    rep["link_wrong_link"] = round(float((p[yt == 0] >= 0.5).mean()), 3)
    _dump({"model": lr().fit(Xl, yl), "feats": am.LINK_FEATS}, out / "link_lr.joblib")

    Xs, ys = am.build_score(rng)
    m = LogisticRegression(max_iter=2000).fit(Xs[: len(ys) * 4 // 5], ys[: len(ys) * 4 // 5])
    rep["score_auc"] = round(float(roc_auc_score(ys[len(ys) * 4 // 5:], m.predict_proba(Xs[len(ys) * 4 // 5:])[:, 1])), 3)
    full = LogisticRegression(max_iter=2000).fit(Xs, ys)
    rep["score_weights"] = {k: round(float(c), 2) for k, c in zip(am.SCORE_FEATS, full.coef_[0])}
    _dump({"model": full, "feats": am.SCORE_FEATS}, out / "score_lr.joblib")

    Xa = am.build_anomaly(rng)
    cut = len(Xa) * 4 // 5
    iso = lambda: IsolationForest(n_estimators=_n(200), contamination=0.01, random_state=0, n_jobs=-1)
    m = iso().fit(Xa[:cut])
    thr = -float(m.offset_)
    rep["anomaly_normal_alarm_10s"] = round(float((-m.score_samples(Xa[cut:]) > thr).mean()), 3)
    full_iso = iso().fit(Xa)
    _dump({"model": full_iso, "feats": am.ANOM_FEATS, "threshold": -float(full_iso.offset_)}, out / "anomaly_if.joblib")
    return rep


if __name__ == "__main__":
    if sys.argv[1:] == ["three"]:
        print(train_three())
    elif sys.argv[1:] == ["agent"]:
        r = train_agent()
        path = settings.artifacts_dir / "train_report.json"
        rep = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        rep.update(r)
        path.write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
        print(json.dumps(r, ensure_ascii=False, indent=1))
    else:
        main()
