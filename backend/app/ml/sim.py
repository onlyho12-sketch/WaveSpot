"""근거 기반 모의 전파 (설계안 v10 · 실측 아님, 화면 · 문서에 '모의'로 표시).

파라미터 출처
 - 경로손실: 공개 학교 BLE 데이터(Mendeley, CC BY 4.0) 8 m 이내 적합 1 m -74.3 dBm, n 1.67, σ 5.8 dB
   (WaveSpot_데이터/_scripts/v10/fit_pathloss.py · pathloss_fit.json)
 - 인체 차폐: Leith & Farrell 2020 (arXiv:2006.06822) 몸이 경로를 가리면 약 10~20 dB 하락 -> 50% 확률
 - 좌석 간격 0.91 m · 줄 간격 2.125 m (9.1 x 8.5 m 교실 · 4줄 x 10석), 휴대형 통로 거리 0.6 m (v10 검증 ⑤)
 - 가정: 설치형 수신기는 천장 네 모서리 2.7 m, 기기는 책상 높이 0.9 m, 벽 감쇠 8~12 dB, 수신 한계 -98 dBm
"""
import numpy as np

A_1M, N_EXP, SIGMA = -74.3, 1.67, 5.8
SHADOW_P, SHADOW_DB = 0.5, (10.0, 20.0)
ROWS, COLS = 4, 10
SEAT_X, ROW_Y = 0.91, 2.125
ROOM_W, ROOM_D = COLS * SEAT_X, ROWS * ROW_Y
DZ = 1.8  # 천장 수신기와 책상 높이 차
FLOOR = -98.0  # 이보다 약하면 수신 안 됨
NODES = ["R1", "R2", "R3", "R4"]
NODE_XY = {"R1": (0.0, 0.0), "R2": (ROOM_W, 0.0), "R3": (0.0, ROOM_D), "R4": (ROOM_W, ROOM_D)}  # 앞 왼쪽부터


def seat_xy(seat: int) -> tuple[float, float]:
    r, c = (seat - 1) // COLS, (seat - 1) % COLS
    return (c + 0.5) * SEAT_X, (r + 0.5) * ROW_Y


def pathloss(d: float | np.ndarray) -> float | np.ndarray:
    return A_1M - 10 * N_EXP * np.log10(np.maximum(d, 0.3))


def outside_xy(rng: np.random.Generator) -> tuple[float, float, float]:
    """복도(앞 벽 밖) 또는 옆 교실 위치와 벽 감쇠."""
    wall = rng.uniform(8, 12)
    if rng.random() < 0.5:
        return rng.uniform(0, ROOM_W), -rng.uniform(1.0, 3.0), wall
    side = rng.choice([-1, 1])
    x = -rng.uniform(1.0, 4.0) if side < 0 else ROOM_W + rng.uniform(1.0, 4.0)
    return x, rng.uniform(0, ROOM_D), wall


class Radio:
    """설치형 4대가 한 기기에서 받는 세기 (1초에 1건, 10초마다 몸 가림 상태가 바뀜)."""

    def __init__(self, rng: np.random.Generator) -> None:
        self.rng = rng
        self.shadow: dict[tuple[str, str], float] = {}

    def sample(self, key: str, x: float, y: float, wall: float, t: float) -> dict[str, float]:
        out = {}
        for n, (nx, ny) in NODE_XY.items():
            sk = (key, n, int(t // 10))
            if sk not in self.shadow:
                self.shadow[sk] = self.rng.uniform(*SHADOW_DB) if self.rng.random() < SHADOW_P else 0.0
            d = float(np.sqrt((x - nx) ** 2 + (y - ny) ** 2 + DZ**2))
            v = pathloss(d) - wall - self.shadow[sk] + self.rng.normal(0, SIGMA)
            if v > FLOOR:
                out[n] = float(v)
        if len(self.shadow) > 20000:
            self.shadow.clear()
        return out


def window(rng: np.random.Generator, x: float, y: float, wall: float = 0.0, n: int = 10) -> np.ndarray:
    """학습용: 10초 창의 수신기별 중앙값 (안 잡히면 -100)."""
    radio = Radio(rng)
    acc = {k: [] for k in NODES}
    t0 = rng.uniform(0, 1e6)
    for i in range(n):
        for k, v in radio.sample("x", x, y, wall, t0 + i).items():
            acc[k].append(v)
    return np.array([np.median(acc[k]) if acc[k] else -100.0 for k in NODES])


def handheld_rssi(rng: np.random.Generator, d: float, shadow: float) -> float:
    return float(pathloss(d) - shadow + rng.normal(0, SIGMA))
