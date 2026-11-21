"""모델 입력 특징 (설계안 v10 검증 ⑦: 상대 세기 + 수신 여부 + 수신기 쌍 차이 + 세기 순위)."""
from itertools import combinations

import numpy as np

from app.ml.sim import COLS, NODES

MISSING = -100.0
PAIRS = list(combinations(range(len(NODES)), 2))


def location_features(X: np.ndarray) -> np.ndarray:
    """X: (창 수, 수신기 4) 중앙값 세기 -> 위치 · 안/밖 모델 입력."""
    X = np.atleast_2d(np.asarray(X, float))
    heard = X > MISSING
    rel = X - X.max(1, keepdims=True)
    rel[~heard] = -40.0
    diffs = np.stack([np.where(heard[:, i] & heard[:, j], X[:, i] - X[:, j], 0.0) for i, j in PAIRS], 1)
    rank = np.argsort(np.argsort(-X, 1), 1)
    strongest = X.max(1, keepdims=True)
    return np.hstack([rel, diffs, rank, heard.sum(1, keepdims=True), strongest])


def zone_of_seat(seat: int) -> int:
    """좌석 번호 -> 반쪽 줄 구역 (1~5번 = 1구역 ...)."""
    return (seat - 1) // 5 + 1


def seats_of_zone(zone: int) -> list[int]:
    return list(range((zone - 1) * 5 + 1, zone * 5 + 1))


def seat_rc(seat: int) -> tuple[int, int]:
    return (seat - 1) // COLS, (seat - 1) % COLS
