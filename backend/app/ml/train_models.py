"""모델 학습 · 근거 기반 모의 데이터 (설계안 v10 · 실측 전).

교실 40석 데이터는 v10에서 '내부 참고 검증만 · 모델 학습 안 함'으로 정해 여기서 쓰지 않음.
  zone_rf   : 반쪽 줄 8구역 (설치형 4대 세기, app/ml/sim.py 모의)
  inside_rf : 교실 안 / 밖 (교실 좌석 vs 복도 · 옆 교실, 같은 모의)
  wifi_rf   : Wi-Fi 용도 4종 (app/ml/wifi_sim.py · 논문 수치 기반 모의)
실측(우리 교실 기준점 10곳 · 팀 기기 · 용도 재현)을 하면 같은 함수로 교체 학습.
실행: backend 폴더에서  .venv/Scripts/python -m app.ml.train_models
"""
import json

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier

from app.core.config import settings
from app.ml import sim, wifi_sim
from app.ml.features import location_features, zone_of_seat


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
    rf = lambda: RandomForestClassifier(n_estimators=120, max_depth=14, min_samples_leaf=5, n_jobs=-1, random_state=0)

    X, zone, Xo = build_location(rng)
    F_in = location_features(X); F_out = location_features(Xo)
    acc_zone = holdout(rf, F_in, zone, rng=rng)
    Fi = np.vstack([F_in, F_out]); yi = np.r_[np.ones(len(F_in)), np.zeros(len(F_out))].astype(int)
    acc_inside = holdout(rf, Fi, yi, rng=rng)
    joblib.dump({"model": rf().fit(F_in, zone), "kind": "zone"}, out / "zone_rf.joblib")
    joblib.dump({"model": rf().fit(Fi, yi), "kind": "inside"}, out / "inside_rf.joblib")

    Xw, yw, gw = build_wifi(rng)
    acc_wifi = holdout(lambda: RandomForestClassifier(300, min_samples_leaf=2, random_state=0, n_jobs=-1), Xw, yw, gw, rng)
    joblib.dump({"model": RandomForestClassifier(300, min_samples_leaf=2, random_state=0, n_jobs=-1).fit(Xw, yw),
                 "feats": wifi_sim.FEATS}, out / "wifi_rf.joblib")

    report = {"data": "근거 기반 모의 (실측 아님)", "zone_8_accuracy": round(acc_zone, 3),
              "inside_accuracy": round(acc_inside, 3), "wifi_usage_accuracy_10s": round(acc_wifi, 3)}
    (out / "train_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(report)


if __name__ == "__main__":
    main()
