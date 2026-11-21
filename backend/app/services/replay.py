"""녹화 재생 · 근거 기반 모의 데이터 데모 모드 (설계안 v10 · 실측 아님, 화면 상단에 '모의 데이터' 표시).

설치형 4대 세기 · 휴대형 세기는 app/ml/sim.py (공개 데이터 적합 경로손실 + 인체 차폐 논문값),
Wi-Fi 프레임은 app/ml/wifi_sim.py (논문 수치) 로 생성. t 는 시험 시작 기준 초 (음수 = 입실 전).
시나리오는 설계안 v10 '상황별 호출 시나리오' ①~⑦ 을 한 교시에 담음.
"""
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from app.ml import sim, wifi_sim
from app.services.readings import Reading


@dataclass
class SimDevice:
    base: str
    label: str  # 시나리오 설명용 (감독관 화면에는 노출 안 함)
    where: int | str  # 좌석 번호 | "desk" | "tv" | "outside"
    t_on: float
    t_off: float = 1e9
    rotate: float = 0.0  # 주소 변경 주기 (초, 0 = 고정)
    meta: dict[str, Any] = field(default_factory=dict)
    wifi: list[tuple[float, float, str]] = field(default_factory=list)  # (시작, 끝, 용도)
    duty: tuple[float, float] | None = None  # (켜진 초, 주기) · 짧게 끊어 보내기 재현
    evade: bool = False  # 휴대형이 다가오면 끄기 재현 (순회 중에는 신호 없음)

    def on(self, t: float) -> bool:
        if not (self.t_on <= t < self.t_off):
            return False
        return self.duty is None or (t - self.t_on) % self.duty[1] < self.duty[0]


def _demo() -> dict[str, Any]:
    return {
        "title": "시연 · v10 상황 ①~⑦ (모의 데이터)",
        "devices": [
            # ① 허용 목록 · ③ 주소만 바뀐 정상 기기 (감독관 폰은 15분마다 주소 변경)
            SimDevice("desk-phone", "감독관 휴대폰", "desk", -1200, rotate=900, meta={"company": "0x0075", "interval": 300}),
            SimDevice("tv", "교실 TV", "tv", -1200, meta={"company": "0x00E0", "interval": 1000}),
            # ② 복도 · 옆 교실 신호
            SimDevice("next-watch", "옆 교실 스마트워치", "outside", 120, 1500, rotate=600, meta={"company": "0x0075", "interval": 500}),
            # ④ 수거 후 새 BLE · Wi-Fi 없음 (10분마다 주소 변경 · BLE 원본의 Microsoft 기기와 같은 주기)
            SimDevice("ear", "숨긴 무선 이어폰", 27, 420, rotate=600, meta={"company": "0x004C", "interval": 30}),
            # ⑤ 큰 Wi-Fi 상향 전송 지속
            SimDevice("phone", "숨긴 휴대폰", 14, 1800, rotate=900, meta={"company": "0x0075", "interval": 200},
                      wifi=[(1800, 1860, "idle"), (1860, 9e9, "video_call")]),
        ],
        "node_fail": ("R3", 3300, 3420),  # ⑦ 장비 이상 (수신기 3/4)
    }


def _quiet() -> dict[str, Any]:
    return {
        "title": "부정행위자 없는 교시 (모의 데이터)",
        "devices": [
            SimDevice("desk-phone", "감독관 휴대폰", "desk", -1200, rotate=900, meta={"company": "0x0075", "interval": 300}),
            SimDevice("tv", "교실 TV", "tv", -1200, meta={"company": "0x00E0", "interval": 1000}),
            SimDevice("next-watch", "옆 교실 스마트워치", "outside", 300, 2400, rotate=600, meta={"company": "0x0075", "interval": 500}),
        ],
        "node_fail": None,
    }


SCENARIOS = {"demo": _demo(), "quiet": _quiet()}


class Replay:
    def __init__(self, scenario: str = "demo", seed: int = 7) -> None:
        self.scenario = scenario if scenario in SCENARIOS else "demo"
        spec = (_demo if self.scenario == "demo" else _quiet)()
        self.devices: list[SimDevice] = spec["devices"]
        self.node_fail = spec["node_fail"]
        self.rng = np.random.default_rng(seed)
        self.radio = sim.Radio(self.rng)
        self.pos: dict[str, tuple[float, float, float]] = {}
        self.walking: set[str] = set()  # 지금 휴대형이 순회 중인 기기 (evade 기기는 이 동안 끔)
        self.fake_until = -1e9  # 가짜 측정값 주입 재현
        for d in self.devices:
            self._place(d)

    def _place(self, d: SimDevice) -> None:
        if d.where == "desk":
            self.pos[d.base] = (sim.ROOM_W / 2, 0.3, 0.0)
        elif d.where == "tv":
            self.pos[d.base] = (0.3, 0.2, 0.0)
        elif d.where == "outside":
            self.pos[d.base] = sim.outside_xy(self.rng)
        else:
            x, y = sim.seat_xy(int(d.where))
            self.pos[d.base] = (x + self.rng.uniform(-0.2, 0.2), y + self.rng.uniform(-0.4, 0.4), 0.0)

    # ---------- 우회 · 해킹 재현 (설계안 20장 실험 8) ----------
    def add_device(self, d: SimDevice) -> None:
        self.devices.append(d)
        self._place(d)

    def move(self, base: str, seat: int) -> bool:
        """허용된 기기를 좌석으로 옮김 (입실 전 미리 켜 둔 기기를 몸에 지님 = 정상 기기 위장)."""
        for d in self.devices:
            if d.base == base:
                d.where = seat
                self._place(d)
                return True
        return False

    def _silent(self, d: SimDevice) -> bool:
        return d.evade and any(a.startswith(d.base + "-") for a in self.walking)

    def addr(self, d: SimDevice, t: float) -> str:
        k = int((t - d.t_on) // d.rotate) if d.rotate else 0
        return f"{d.base}-{k:02d}"

    def node_down(self, t: float) -> str | None:
        if self.node_fail and self.node_fail[1] <= t < self.node_fail[2]:
            return self.node_fail[0]
        return None

    def readings_at(self, t: float) -> list[Reading]:
        out: list[Reading] = []
        down = self.node_down(t)
        for d in self.devices:
            if not d.on(t) or self._silent(d):
                continue
            x, y, wall = self.pos[d.base]
            meta = dict(d.meta)
            if int(t) % 10 == 9:  # 창마다 Wi-Fi 프레임 특징 (모의)
                use = next((u for a, b, u in d.wifi if a <= t < b), None)
                if use:
                    meta["wifi_feat"] = wifi_sim.window_features(self.rng, use)
            for n, v in self.radio.sample(d.base, x, y, wall, t).items():
                if n != down:
                    out.append(Reading(t, self.addr(d, t), n, v, meta))
        if t < self.fake_until:
            # 외부 조력자가 수신기를 흉내 내 보낸 값: 등록 안 된 수신기 R9 + 네 모서리 모두 아주 강한(물리적으로 불가능한) 세기
            out.append(Reading(t, "fake-r9", "R9", -40.0, {"company": "0x0075", "interval": 100}))
            for n in sim.NODES:
                out.append(Reading(t, "fake-dev-00", n, -38.0 + float(self.rng.normal(0, 1)), {"company": "0x0075", "interval": 100}))
        return out

    def confiscate(self, addr: str, t: float) -> None:
        for d in self.devices:
            if addr.startswith(d.base + "-"):
                d.t_off = t

    def true_seat(self, addr: str) -> int | None:
        for d in self.devices:
            if addr.startswith(d.base + "-") and isinstance(d.where, int):
                return d.where
        return None

    def device_xy(self, addr: str) -> tuple[float, float] | None:
        for d in self.devices:
            if addr.startswith(d.base + "-") and d.t_off > 1e8 and not d.evade:
                return self.pos[d.base][:2]
        return None  # 꺼져 있거나 순회 중 끈 기기 -> 휴대형에 안 잡힘

    def walk(self, seats: list[int], addr: str, dwell: int = 2):
        """휴대형 순회 (v10 검증 ⑤): 좌석 뒤 통로 0.6 m, 좌석마다 dwell초(기본 2초 = 0.25초 x 8건) 머무름, 앞 · 뒤 2회 통과.
        통과마다 몸 방향이 달라 차폐가 바뀜. 좌석별 '중앙값의 최댓값'이 가장 큰 좌석을 고름."""
        target = self.device_xy(addr)
        hist: list[float] = []
        seat_best: dict[int, float] = {}
        peak = -999.0
        for p, offset in enumerate((0.6, -0.6)):
            shadow = self.rng.uniform(10, 20) if self.rng.random() < 0.5 else 0.0
            for s in (seats if p == 0 else list(reversed(seats))):
                sx, sy = sim.seat_xy(s)
                vals = []
                for _ in range(max(1, int(dwell * 4))):
                    if target is None:
                        v = sim.FLOOR - 1
                    else:
                        d = float(np.hypot(sx - target[0], sy + offset - target[1]))
                        v = sim.handheld_rssi(self.rng, d, shadow)
                    vals.append(v); hist.append(v)
                    med = float(np.median(hist[-10:]))
                    peak = max(peak, med)
                    yield {"pos_seat": s, "pass": p + 1, "rssi": round(med, 1), "rel_db": round(med - peak, 1)}
                seat_best[s] = max(seat_best.get(s, -999.0), float(np.median(vals)))
        yield {"done": True, "seat_medians": {k: round(v, 1) for k, v in seat_best.items()},
               "best_seat": max(seat_best, key=seat_best.get) if seat_best else None}
