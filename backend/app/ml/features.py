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
    """위치 모델이 맞히는 반쪽 줄 5석 (학습 라벨용). 수색할 좌석은 range_seats."""
    return list(range((zone - 1) * 5 + 1, zone * 5 + 1))


# 수색 범위 = 원. 중심은 위치 모델이 고른 반쪽 줄의 가운데 좌석, 원 안에 좌석 중심이 드는 자리를 휴대형으로 순회.
# 감독 화면 좌석 배치도와 같은 비율(옆 간격 1, 앞뒤 간격 1.3)로 계산 (frontend lib/utils.ts rangeSeats 와 같음)
ROW_RATIO = 1.3
ROI_R = 1.4  # 반지름 (좌석 칸 수) · 가운데 좌석과 바로 옆 · 앞 · 뒤 좌석만
ROI_WIDE = 1.35  # 수신기 1대가 끊기면 넓힘


def center_seat(zone: int) -> int:
    half = (COLS + 1) // 2
    return (zone - 1) // 2 * COLS + (zone - 1) % 2 * half + half // 2 + 1


def range_seats(zone: int, wide: bool = False) -> list[int]:
    """원 안 좌석 (번호 순). 예: 6번 범위(28번 주변) = 18, 27~29, 38번."""
    from app.ml.sim import ROWS
    half = (COLS + 1) // 2
    cx, cy = (zone - 1) % 2 * half + half / 2, ((zone - 1) // 2 + 0.5) * ROW_RATIO
    r = ROI_R * (ROI_WIDE if wide else 1)
    return [s for s in range(1, ROWS * COLS + 1)
            if np.hypot((s - 1) % COLS + 0.5 - cx, ((s - 1) // COLS + 0.5) * ROW_RATIO - cy) <= r]


def range_name(zone: int) -> str:
    return f"{center_seat(zone)}번 주변"


def seat_text(seats: list[int]) -> str:
    """[17, 18, 19, 26, 27] -> '17~19, 26~27번'"""
    runs: list[list[int]] = []
    for s in sorted(seats):
        if runs and s == runs[-1][-1] + 1:
            runs[-1].append(s)
        else:
            runs.append([s])
    return ", ".join(f"{r[0]}~{r[-1]}" if len(r) > 1 else f"{r[0]}" for r in runs) + "번"


def seat_rc(seat: int) -> tuple[int, int]:
    return (seat - 1) // COLS, (seat - 1) % COLS
