"""WaveSpot AI 에이전트 (설계안 v10 9장).

판단 순서 : 신호 감지(기기 연결 · 교실 안/밖 · 30초 연속) -> 위치 추정(구역 · 종류/용도 · 점수) -> 수색(휴대형 · 정밀 수색)
수색 강화 사다리 (애매하면 사람에게 넘기지 않고 더 세게 확인)
  Lv0 이상 없음   허용 목록 밖 신호 없음
  Lv1 추가 관찰   점수 40 이상인데 '더 볼 때 얻는 것 > 잃는 것', 또는 묶기 보류 -> 30초 더 관찰
  Lv2 휴대형 접근 얻는 것 <= 잃는 것, 또는 Wi-Fi 영상 · 사진 전송 패턴 -> 반쪽 줄 구역 안내
  Lv3 정밀 수색   70점 이상 30초 연속 + 근거 2개 이상 -> 의심 부정행위자(좌석) 지정, 금속탐지기
  Lv4 2차 수색    Lv3 미발견인데 같은 신호가 계속됨 -> 다른 부위 · 소지품 · 책상, 학습 보류
상황마다 필요한 모델만 부르고, 부른 모델 · 건너뛴 모델을 기록 (파이프라인 대비 호출 수 비교).

AI 모델 6개 (설계안 7장 · 모두 근거 기반 모의 데이터로 학습, 실측 후 교체)
  이상 감지   Isolation Forest      교실 전체 10초 창마다 1번 (Lv0 이상 없음 · '있나')
  기기 묶기   로지스틱 회귀         새 주소가 나타날 때 · 허용 기기 확인
  위치 추정   랜덤 포레스트 2개     교실 안/밖 -> 반쪽 줄 구역 (수신기 1대 끊기면 3대용)
  기기 종류   랜덤 포레스트         Wi-Fi 없이 블루투스만 잡힐 때
  Wi-Fi 용도  랜덤 포레스트         Wi-Fi 프레임이 잡힐 때 (종류 대신)
  위험 점수   로지스틱 회귀         위치까지 확인된 기기

우회 대응 (v11 10장 · 절차를 아는 부정행위자):
  - 기준 점수 · 관찰 기준을 교시마다 조금씩 무작위로 흔듦 (정확한 경계선을 알 수 없게, 값은 관리자만)
  - 짧게 끊어 보내도 교시 단위로 누적 -> '끊어 보내기' 근거
  - 휴대형이 다가오는 동안 신호가 사라지면 그 반응 자체를 근거 +1
  - 허용 기기의 신호 지문(입실 전 자리)과 대조 -> 좌석 쪽에서 잡히면 허용 해제 · 조사
  - 1분에 여러 번 주소를 바꾸면 그 자체를 근거로 사용
"""
import secrets
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from typing import Any

from sqlmodel import Session

from app.agent.kinds import KIND_LABEL, KIND_WEIGHT, SEARCH_PARTS, guess_kind, parts_by_signal
from app.agent.linking import Linker
from app.ml.agent_models import ANOM_SPAN, AgentModels, anomaly_features
from app.core.config import settings
from app.core.db import engine
from app.ml.features import range_name, range_seats, seat_text
from app.ml.location import LocationResult, Locator
from app.ml.wifi_sim import LABEL as USAGE_LABEL, RISK
from app.models import AgentEvent, SearchRequest
from app.services import integrity

Emit = Callable[[str, Any], Awaitable[None]]
MODELS = ["묶기", "안/밖", "위치", "종류", "용도", "점수"]  # 기기마다 부르는 모델 · 파이프라인은 창마다 기기마다 모두 실행
ROOM_MODEL = "이상"  # 이상 감지: 기기마다가 아니라 교실 전체 창마다 1번 (에이전트 · 파이프라인 같음)
ANOM_CONFIRM = 2  # 30초 평균 특징이 이만큼 연속 창에서 '평소와 다름'이면 기록
ANOM_CLEAR = 6  # 이만큼 연속(60초) 평소 수준이면 끝난 것으로 봄 (경계에서 깜빡이지 않게)
BURST_GAP = 20.0  # 마지막 패킷 뒤 이만큼 넘게 안 잡혔다가 다시 잡히면 '한 번 끊었다 다시 보냄'
ROTATE_LIMIT = 4  # 1분에 주소를 이만큼 이상 바꾸면 이상
SPOOF_DB = 7.5  # 허용 기기 지문(최근 30창 평균)이 입실 전과 이만큼(dB) 넘게 달라지면 위장 의심
SPOOF_N = 30  # 지문 비교에 쓰는 최근 창 수 (5분) · 모의 데이터에서 정지 기기 최대 7.0 dB vs 옮긴 기기 중앙 9.2 dB
Detect = Callable[[str, str | None, float, str], Awaitable[None]]


def contrast(rssi: dict[str, float]) -> tuple[float, float] | None:
    """수신기 4대 세기의 앞뒤 · 좌우 차이 = 기기 자리의 지문 (세기 절대값보다 출력 · 몸 가림에 덜 흔들림)."""
    v = {n: rssi.get(n) for n in ("R1", "R2", "R3", "R4")}
    if any(x is None for x in v.values()):
        return None
    return ((v["R1"] + v["R2"]) - (v["R3"] + v["R4"]), (v["R1"] + v["R3"]) - (v["R2"] + v["R4"]))


@dataclass
class Track:
    meta_id: str
    first_t: float
    addr: str = ""
    status: str = "new"  # outside | observing | caution | approach | requested | resolved
    level: int = 0
    consec: int = 0
    out_consec: int = 0
    high: int = 0
    inside_since: float | None = None
    last_inside: float = -1e9
    p_in: float = 0.5
    score: int = 0
    kind: str = "unknown"
    kind_p: float = 0.0
    kind_method: str = "규칙"
    usage: tuple[str, float] | None = None
    meta: dict[str, Any] = field(default_factory=dict)
    loc: LocationResult | None = None
    flags: set[str] = field(default_factory=set)
    hold: dict[str, Any] | None = None  # 묶기 보류 {candidate, until}
    request_id: int | None = None
    steps: list[dict[str, Any]] = field(default_factory=list)
    zsum: dict[int, float] = field(default_factory=dict)
    zn: int = 0
    last_seen: float | None = None
    last_pkt: float | None = None  # 마지막으로 받은 패킷 시각 (끊어 보내기 간격 계산)
    bursts: int = 0  # 끊었다 다시 보낸 횟수 (교시 누적)
    seen_sec: float = 0.0  # 교시 동안 잡힌 총 시간
    addr_changes: list[float] = field(default_factory=list)
    quiet_walk: int = 0  # 휴대형 순회 중 안 잡힌 창 수


def clock(t: float, start: str = "09:00") -> str:
    h, m = map(int, start.split(":"))
    s = int(h * 3600 + m * 60 + t)
    return f"{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}"


def mmss(sec: float) -> str:
    sec = int(sec)
    return f"{sec // 60}분 {sec % 60:02d}초" if sec >= 60 else f"{sec}초"


def zone_gain(zone_prob: float) -> float:
    """30초 더 볼 때 구역 확신이 오르는 정도 (모의 누적 실험: 10초 29% -> 30초 45% -> 60초 51% -> 120초 54%)."""
    return 0.16 if zone_prob < 0.35 else 0.06 if zone_prob < 0.5 else 0.03


class Agent:
    def __init__(self, session_id: int, emit: Emit, start_label: str = "09:00") -> None:
        self.session_id = session_id
        self.emit = emit
        self.start_label = start_label
        self.locator = Locator()
        self.models = AgentModels()  # 기기 종류 · 기기 묶기 · 위험 점수 · 이상 감지
        self.linker = Linker(self.models)
        self.anom_run = 0  # 이상 감지 연속 창 수
        self.anom_calm = 0
        self.anom_on = False
        self.anom_last: dict[str, Any] | None = None
        self.anom_hist: list[list[float]] = []  # 최근 창 특징 (30초 평균용)
        self.allow: dict[str, str] = {}  # 메타기기 -> 설명
        self.tracks: dict[str, Track] = {}
        # 수색 결과는 기록만 하고 시험 중 점수 · 기준은 바꾸지 않음 (v12: 학습은 시험 후 사람 검토를 거쳐 시험 없는 기간에만)
        self.review: list[dict[str, Any]] = []  # 시험 후 검토할 결과 {request_id, result, device_id}
        # by_model: 모델별 에이전트 호출 수 (파이프라인은 모델마다 device_windows 회)
        # series: 분마다 [경과 분, 에이전트 누적 호출, 파이프라인 누적 호출] (관리 화면 추이 그래프)
        self.stats: dict[str, Any] = {"windows": 0, "device_windows": 0, "agent_calls": 0, "pipeline_calls": 0,
                                      "by_model": {m: 0 for m in [ROOM_MODEL, *MODELS]}, "series": []}
        self.nodes_ok = 4
        self.down: list[str] = []
        # 교시마다 흔드는 비공개 기준 (설계안: 기준값 · 시간 창은 교실별로 학습해 비공개, 회차마다 조금씩 무작위)
        self.req_score = settings.request_score + secrets.choice([-3, -2, -1, 0, 1, 2, 3])
        self.caution_score = settings.caution_score + secrets.choice([-2, -1, 0, 1, 2])
        self.fp_sum: dict[str, list[tuple[float, float]]] = {}  # 입실 전 허용 기기 지문
        self.fp: dict[str, tuple[float, float]] = {}
        self.fp_recent: dict[str, list[tuple[float, float]]] = {}
        self.fp_hits: dict[str, int] = {}
        self.on_detect: Detect | None = None  # 엔진이 연결 (우회 · 해킹 탐지 기록)
        self.detected: set[tuple[str, str | None]] = set()

    # ---------- 기록 ----------
    async def log(self, t: float, stage: str, message: str, level: str = "info", meta_id: str | None = None,
                  data: dict | None = None) -> None:
        ev = AgentEvent(session_id=self.session_id, sim_time=t, device_id=meta_id, stage=stage, level=level,
                        message=message, data=data)
        with Session(engine) as s:
            s.add(ev)
            s.flush()
            integrity.append(s, self.session_id, "event", ev.id, integrity.event_body(ev))  # 추가만 되는 기록 + 해시 체인
            s.commit()
            s.refresh(ev)
        payload = ev.model_dump()
        payload["clock"] = clock(t, self.start_label)
        if meta_id and meta_id in self.tracks:
            self.tracks[meta_id].steps.append({"clock": payload["clock"], "stage": stage, "message": message})
        await self.emit("event", payload)

    def _calls(self, used: list[str]) -> dict[str, list[str]]:
        self.stats["agent_calls"] += len(used)
        for m in used:
            self.stats["by_model"][m] = self.stats["by_model"].get(m, 0) + 1
        return {"calls": used, "skipped": [m for m in MODELS if m not in used]}

    # ---------- 입실 전 기준선 ----------
    def baseline_window(self, windows: dict[str, dict[str, Any]], t: float) -> None:
        active: set[str] = set()
        for addr, w in windows.items():
            mid = self.linker.known(addr)
            if mid is None:
                kind, cand, _, _ = self.linker.decide(self.linker.candidates(addr, w["meta"], w["rssi"], t, active))
                mid = cand if kind == "link" and cand else f"m-{addr}"
            active.add(mid)
            self.linker.touch(mid, addr, w["meta"], w["rssi"], t)
            c = contrast(w["rssi"])
            if c:
                self.fp_sum.setdefault(mid, []).append(c)

    def finish_baseline(self) -> None:
        """허용 기기마다 입실 전 자리의 지문 = 창별 차이의 중앙값 (몸 가림 · 잡음에 강하게)."""
        import statistics

        for mid, cs in self.fp_sum.items():
            if len(cs) >= SPOOF_N:
                self.fp[mid] = (statistics.fmean(c[0] for c in cs), statistics.fmean(c[1] for c in cs))

    async def detect(self, kind: str, meta_id: str | None, t: float, detail: str) -> None:
        if (kind, meta_id) in self.detected:
            return
        self.detected.add((kind, meta_id))
        if self.on_detect:
            await self.on_detect(kind, meta_id, t, detail)

    # ---------- 창 단위 판단 ----------
    async def process(self, windows: dict[str, dict[str, Any]], t: float, nodes_ok: int = 4, down: list[str] | None = None,
                      walking: set[str] | None = None) -> None:
        """walking: 지금 휴대형 순회 대상 기기 (그동안 신호가 사라지면 '접근 시 끄기' 근거)."""
        self.down = sorted(down or [])
        await self._equipment(nodes_ok, t)
        self.stats["windows"] += 1
        await self._anomaly(windows, t)
        active: set[str] = {m for a in windows if (m := self.linker.known(a))}
        spans = {m: windows[a].get("span") for a in windows if (m := self.linker.known(a))}
        seen: set[str] = set()
        for addr, w in windows.items():
            self.stats["device_windows"] += 1
            self.stats["pipeline_calls"] += len(MODELS)
            mid = self.linker.known(addr)
            if mid is None:
                # 창 중간에 주소를 바꾸면 옛 주소 · 새 주소가 한 창에 같이 들어옴: 옛 주소가 새 주소보다 먼저 끊겼으면 이어 붙일 수 있음
                ns = w.get("span")
                busy = {m for m in active if not (ns and spans.get(m) and spans[m][1] < ns[0])}
                mid = await self._link_new(addr, w, t, busy)
                active.add(mid)
            self.linker.touch(mid, addr, w["meta"], w["rssi"], t, (w.get("span") or (None, None))[1])
            seen.add(mid)
            if mid in self.allow:
                self._calls(["묶기"])
                if not await self._check_allowed(mid, w, t):
                    continue
            tr = self.tracks.get(mid)
            if tr is None:
                tr = self.tracks[mid] = Track(mid, first_t=t)
            await self._habits(tr, addr, t, w.get("span"))
            tr.addr = addr
            tr.meta.update(w["meta"])
            await self._step(tr, w, t)
        for mid in walking or ():
            tr = self.tracks.get(mid)
            if tr and mid not in seen:
                tr.quiet_walk += 1
        minute = int(max(t, 0) // 60)
        series = self.stats["series"]
        point = [minute, self.stats["agent_calls"], self.stats["pipeline_calls"]]
        if series and series[-1][0] == minute:
            series[-1] = point
        else:
            series.append(point)
        await self.emit("devices", self.snapshot())
        await self.emit("stats", self.stats)

    async def _anomaly(self, windows: dict[str, dict[str, Any]], t: float) -> None:
        """이상 감지 모델 (Lv0 이상 없음): 교실 전체 창 통계가 정상 교실과 얼마나 다른지. 창마다 1번 · 파이프라인도 같음."""
        allowed = {a for a in windows if (m := self.linker.known(a)) and m in self.allow}
        new = {a for a in windows if self.linker.known(a) is None}
        self.anom_hist = (self.anom_hist + [anomaly_features(windows, allowed, new)])[-ANOM_SPAN:]
        f = [sum(col) / len(self.anom_hist) for col in zip(*self.anom_hist)]  # 최근 30초 평균
        r = self.models.anomaly(f)
        self.stats["pipeline_calls"] += 1
        if r is None:
            return
        self.stats["agent_calls"] += 1
        self.stats["by_model"][ROOM_MODEL] = self.stats["by_model"].get(ROOM_MODEL, 0) + 1
        score, thr = r
        self.anom_last = {"score": round(score, 3), "threshold": round(thr, 3), "addresses": round(f[0], 1), "new": round(f[1], 1),
                          "not_allowed": round(f[2], 1), "same_company_max": round(f[3], 1)}
        self.anom_run = self.anom_run + 1 if score > thr else 0
        self.anom_calm = 0 if score > thr else self.anom_calm + 1
        if self.anom_run >= ANOM_CONFIRM and not self.anom_on:
            self.anom_on = True
            # 감독관이 보는 문장은 짧게, 세부 수치(이상 점수 · 새 주소 수 등)는 data.anomaly 에 남김
            await self.log(t, "신호 감지", "이상 감지 모델: 교실 전체 신호가 평소와 다름 → 기기별로 확인", "caution",
                           data={"calls": [ROOM_MODEL], "skipped": [], "anomaly": self.anom_last})
            if f[4] * ANOM_SPAN >= 2:
                await self.detect("rotate", None, t, f"이상 감지 모델, 30초 동안 허용 목록 밖 새 주소 {round(f[4] * ANOM_SPAN)}개")
        elif self.anom_on and self.anom_calm >= ANOM_CLEAR:
            self.anom_on = False
            await self.log(t, "신호 감지", "이상 감지 모델: 교실 전체 신호가 평소 수준으로 돌아옴", "info",
                           data={"calls": [ROOM_MODEL], "skipped": []})

    async def _check_allowed(self, mid: str, w: dict, t: float) -> bool:
        """허용 기기 지문 대조. 좌석 쪽으로 옮겨졌으면 허용을 풀고 True (= 이번 창부터 조사)."""
        base = self.fp.get(mid)
        c = contrast(w["rssi"])
        if base is None or c is None:
            return False
        recent = self.fp_recent.setdefault(mid, [])
        recent.append(c)
        del recent[:-SPOOF_N]
        if len(recent) < SPOOF_N:
            return False
        import statistics

        now = (statistics.fmean(x[0] for x in recent), statistics.fmean(x[1] for x in recent))
        diff = ((now[0] - base[0]) ** 2 + (now[1] - base[1]) ** 2) ** 0.5
        hits = self.fp_hits.get(mid, 0) + 1 if diff >= SPOOF_DB else 0
        self.fp_hits[mid] = hits
        if hits < 3:  # 3번 연속 (잠깐의 몸 가림 · 잡음으로 허용을 풀지 않게)
            return False
        label = self.allow.pop(mid)
        tr = self.tracks.setdefault(mid, Track(mid, first_t=t))
        tr.status, tr.level = "new", 0
        tr.flags.add("spoof")
        await self.log(t, "보안", f"허용 기기({label.split(', ')[0]})의 수신기 세기 패턴이 입실 전 자리와 {diff:.0f}dB 다름 → 좌석 쪽으로 옮겨진 것으로 보고 허용 해제, 조사 시작 (정상 기기 위장 의심)",
                       "alert", mid)
        await self.detect("spoof", mid, t, f"세기 패턴 차이 {diff:.1f}dB (기준 {SPOOF_DB}dB, 최근 5분 평균)")
        return True

    async def _habits(self, tr: Track, addr: str, t: float, span: tuple[float, float] | None = None) -> None:
        """교시 단위 행동: 끊어 보내기 · 주소 자주 바꾸기 · 순회 때 끄기."""
        win = settings.window_seconds
        # 끊긴 시간은 창 시각이 아니라 실제 패킷 간격으로 잼
        # (창 시각 차이로 재면 같은 25초 끊김도 공격을 건 시점에 따라 20초 또는 30초가 되어, 20초인 경우 한 번도 세지 못했음)
        first, last = span or (t - win, t)
        if tr.last_pkt is not None and first - tr.last_pkt > BURST_GAP:
            tr.bursts += 1
            if tr.bursts == 2:
                await self.log(t, "보안", f"같은 기기가 끊겼다 다시 잡힘 {tr.bursts + 1}번째, 시험 중 누적 {int(tr.seen_sec)}초 → 짧게 끊어 보내는 패턴으로 보고 누적 점수에 반영",
                               "caution", tr.meta_id)
                await self.detect("burst", tr.meta_id, t, f"{tr.bursts + 1}번 나눠 잡힘, 누적 {int(tr.seen_sec)}초")
        tr.seen_sec += win
        tr.last_seen = t
        tr.last_pkt = last
        if tr.addr and addr != tr.addr:
            tr.addr_changes.append(t)
            tr.addr_changes = [x for x in tr.addr_changes if t - x <= 60]
            if len(tr.addr_changes) >= ROTATE_LIMIT and "rotate" not in tr.flags:
                tr.flags.add("rotate")
                await self.log(t, "보안", f"1분에 신호 ID(주소)를 {len(tr.addr_changes)}번 바꿈 → 비정상적으로 잦음, 근거에 추가", "caution", tr.meta_id)
                if not any(k == "rotate" for k, _ in self.detected):  # 이상 감지 모델이 먼저 잡았으면 같은 공격으로 봄
                    await self.detect("rotate", tr.meta_id, t, f"1분에 {len(tr.addr_changes)}번")
        if tr.quiet_walk > 0 and "approach_off" not in tr.flags:
            tr.flags.add("approach_off")
            await self.log(t, "보안", f"휴대형이 다가오는 동안 {tr.quiet_walk * int(win)}초 신호가 꺼졌다가 다시 켜짐 → 다가가자 신호를 끈 것으로 보고 근거에 추가", "alert", tr.meta_id)
            await self.detect("approach_off", tr.meta_id, t, f"순회 중 {tr.quiet_walk * int(win)}초 꺼짐")

    async def _equipment(self, nodes_ok: int, t: float) -> None:
        """v11 10장: 1대 끊김 -> 3대용 위치 모델 · 2대 이상 -> 위치 추정 중단, '있나'만 판단."""
        prev = self.nodes_ok
        if nodes_ok == prev:
            return
        who = ", ".join(self.down)
        if nodes_ok == 3:
            how = "3대용 위치 모델로 전환" if self.down and self.down[0] in self.locator.three else "남은 수신기로 위치를 대략 계산 (3대용 모델 없음)"
            await self.log(t, "장비", f"수신기 {who} 끊김, {how}, 수색 범위 한 단계 넓힘", "caution",
                           data={"calls": ["위치"], "skipped": []})
        elif nodes_ok <= 2:
            await self.log(t, "장비", f"수신기 {who} 끊김 ({nodes_ok}/4), 위치 추정 중지, 반입 금지 기기가 있는지만 판단, 휴대형 순회 권장", "alert",
                           data={"calls": [], "skipped": ["위치"]})
        elif nodes_ok == 4:
            await self.log(t, "장비", "수신기 4/4 복구, 4대용 위치 모델로 복귀", "info")
        self.nodes_ok = nodes_ok

    async def _link_new(self, addr: str, w: dict, t: float, active: set[str]) -> str:
        cands = self.linker.candidates(addr, w["meta"], w["rssi"], t, active)
        kind, cand, sim, gap = self.linker.decide(cands)
        h = self.linker.handoff(w["meta"], (w.get("span") or (None, None))[0], active)
        if kind != "link" and h:
            kind, cand, sim = "link", h, dict(cands).get(h, sim)
        if kind == "link" and cand:
            if cand in self.allow:
                await self.log(t, "신호 감지", f"허용된 기기가 신호 ID(주소)만 바꾼 것 (같은 기기 확률 {sim:.0%}), 확인 끝",
                               "info", cand, self._calls(["묶기"]))
            elif cand in self.tracks:
                await self.log(t, "신호 감지", f"같은 기기가 신호 ID(주소)를 바꿈 (같은 기기 확률 {sim:.0%}), 계속 추적",
                               "info", cand, self._calls(["묶기"]))
            return cand
        mid = f"m-{addr}"
        if kind == "hold" and cand:
            tr = self.tracks[mid] = Track(mid, first_t=t)
            tr.hold = {"candidate": cand, "until": t + 30}
            tr.flags.add("hold")
            await self.log(t, "신호 감지", f"비슷한 기기가 여럿이라 같은 기기인지 아직 모름 (1, 2순위 확률 차이 {gap:.0%}), 30초 더 지켜봄",
                           "caution", mid, self._calls(["묶기"]))
        return mid

    async def _step(self, tr: Track, w: dict, t: float) -> None:
        win, need = settings.window_seconds, settings.confirm_windows
        # 묶기 보류 해제: 30초 동안 후보 기기가 다시 나타나지 않으면 같은 기기로 연결
        if tr.hold and t >= tr.hold["until"]:
            cand = tr.hold["candidate"]
            m = self.linker.metas.get(cand)
            tr.hold = None
            if m and t - m.last_seen > win and cand in self.allow:
                self.allow[tr.meta_id] = self.allow[cand]
                await self.log(t, "신호 감지", "30초 지켜본 결과 허용된 기기와 같은 기기, 확인 끝", "info",
                               tr.meta_id, self._calls(["묶기"]))
                tr.status = "resolved"
                return
            await self.log(t, "신호 감지", "30초 지켜본 결과 다른 기기, 새 기기로 계속 확인", "info", tr.meta_id, self._calls(["묶기"]))
        if tr.status in ("approach", "requested", "searching", "resolved"):
            loc = self.locator.locate(w["rssi"], self.nodes_ok, self.down)
            if loc.p_inside >= 0.5:
                tr.last_inside = t
            if tr.status != "resolved" and self.nodes_ok <= 2:  # 위치 추정 중지: 요청은 그대로 두고 단계만 멈춤
                tr.p_in = 0.6 * tr.p_in + 0.4 * loc.p_inside
                self._calls(["묶기", "안/밖"])
            elif tr.status != "resolved":
                tr.p_in = 0.6 * tr.p_in + 0.4 * loc.p_inside
                self._accumulate(tr, loc)
                self._calls(["묶기", "안/밖", "위치", "점수"])
                await self._escalate(tr, t)  # Lv2 -> Lv3 은 요청이 나간 뒤에도 계속 판단
            return

        # 1) 신호 감지 · 교실 안/밖
        loc = self.locator.locate(w["rssi"], self.nodes_ok, self.down)
        tr.p_in = 0.6 * tr.p_in + 0.4 * loc.p_inside
        if loc.p_inside < 0.5:
            tr.out_consec += 1
            if tr.status in ("observing", "caution") and tr.out_consec < need:
                self._calls(["묶기", "안/밖"])
                return
            calls = self._calls(["묶기", "안/밖"])
            if tr.status != "outside":
                await self.log(t, "신호 감지", f"교실 밖 신호 (교실 안 확률 {loc.p_inside:.0%}), 확인 끝", "info", tr.meta_id, calls)
            tr.status, tr.consec, tr.high, tr.inside_since, tr.level = "outside", 0, 0, None, 0
            return
        tr.out_consec = 0
        tr.last_inside = t
        tr.consec += 1
        if tr.inside_since is None:
            tr.inside_since = t
        if self.nodes_ok <= 2:
            # 수신기 2대 이상 끊김: 구역을 믿을 수 없으므로 위치 · 점수 모델을 부르지 않고 '있다'만 판단
            self._calls(["묶기", "안/밖"])
            if tr.consec >= need and "noloc" not in tr.flags:
                tr.flags.add("noloc")
                await self.log(t, "신호 감지", f"{int(need * win)}초 연속 확인 → 반입 금지 기기 있음, 수신기 {self.nodes_ok}/4라 위치 추정 중지 → 휴대형으로 교실 전체 순회 권장",
                               "caution", tr.meta_id, {"calls": ["묶기", "안/밖"], "skipped": ["위치", "종류", "용도", "점수"]})
            tr.status, tr.level = ("caution", 1) if tr.consec >= need else ("observing", 1)
            return
        tr.flags.discard("noloc")
        self._accumulate(tr, loc)
        loc = tr.loc
        if tr.consec < need:
            calls = self._calls(["묶기", "안/밖"])
            if tr.consec == 1:
                await self.log(t, "신호 감지", f"허용 목록 밖 신호가 교실 안에서 잡힘 (교실 안 확률 {loc.p_inside:.0%}) → {int(need * win)}초 연속 확인",
                               "info", tr.meta_id, calls)
                tr.status, tr.level = "observing", 1
            return

        # 2) 위치 추정 · 단서에 따라 모델 선택
        wifi = tr.meta.get("wifi_feat")
        used = ["묶기", "안/밖", "위치"]
        if wifi:
            tr.usage = self.locator.usage(wifi)
            used.append("용도")
            tr.kind = "phone"
            if tr.usage and tr.usage[0] != "idle" and "wifi_first" not in tr.flags:
                tr.flags.add("wifi_first")
                await self.log(t, "위치 추정", f"Wi-Fi로 데이터를 보내는 중, {USAGE_LABEL[tr.usage[0]]}로 보임 ({tr.usage[1]:.0%})",
                               "caution", tr.meta_id, {"calls": ["용도", "위치", "점수"], "skipped": ["종류"]})
        else:
            k = self.models.kind(tr.meta, guess_kind)
            tr.kind, tr.kind_p, tr.kind_method = k.kind, k.prob, k.method
            used.append("종류")
        used.append("점수")
        calls = self._calls(used)
        score, ev = self._score(tr, loc, t)
        tr.score = score
        if tr.consec == need:
            await self.log(t, "신호 감지", f"{int(need * win)}초 연속 확인 → 반입 금지 기기 있음, {range_name(loc.zone)} 추정, 위험 {score}점", "caution",
                           tr.meta_id, calls)
        if score < self.caution_score:
            tr.status, tr.level, tr.high = "observing", 1, 0
            return
        await self._escalate(tr, t, ev)

    def _accumulate(self, tr: Track, loc: LocationResult) -> None:
        """한 창의 위치 판단은 흔들림 -> 관찰한 창들의 구역 확률을 누적 평균 (Lv1 의 근거)."""
        if loc.p_inside >= 0.5:
            for z, p in loc.zone_probs.items():
                tr.zsum[z] = tr.zsum.get(z, 0.0) + p
            tr.zn += 1
        if tr.zn:
            avg = {z: v / tr.zn for z, v in tr.zsum.items()}
            best = max(avg, key=avg.get)
            loc = replace(loc, zone=best, zone_prob=avg[best], zone_probs=avg)
        tr.loc = loc

    async def _escalate(self, tr: Track, t: float, ev: list[dict[str, Any]] | None = None) -> None:
        loc = tr.loc
        if loc is None:
            return
        if ev is None:
            tr.score, ev = self._score(tr, loc, t)
        score, need = tr.score, settings.confirm_windows
        risk = RISK.get(tr.usage[0], 0.5) if tr.usage else 0.5
        gain = zone_gain(loc.zone_prob) + 0.11 * (1 - tr.p_in) * 2
        loss = 30 / 120 * risk
        strong_usage = tr.usage is not None and tr.usage[0] in ("video_call", "photo_send")

        # Lv3 · 70점 이상 30초 연속 + 근거 2개 이상
        tr.high = tr.high + 1 if score >= self.req_score else 0
        n_evidence = sum(1 for e in ev if (e.get("points") or 0) >= 10)
        if tr.high >= need and n_evidence >= 2:
            if tr.level < 3:
                await self._request(tr, t, 3, ev)
            return
        if tr.status in ("approach", "requested", "searching"):
            return
        # Lv1 vs Lv2 · 기다림의 가치 vs 놓칠 위험
        if strong_usage or gain <= loss:
            why = (f"{USAGE_LABEL[tr.usage[0]]} 패턴이라 위치가 덜 확실해도 바로" if strong_usage
                   else "더 기다려도 위치가 크게 확실해지지 않아")
            await self.log(t, "위치 추정", f"{why} 휴대형 접근, {range_name(loc.zone)}", "caution", tr.meta_id,
                           {"gain": round(gain, 3), "loss": round(loss, 3)})
            await self._request(tr, t, 2, ev)
            return
        tr.status, tr.level = "caution", 1
        if "lv1" not in tr.flags or tr.zn % 3 == 0:
            tr.flags.add("lv1")
            await self.log(t, "위치 추정", f"위험 {score}점, 위치 확신 {loc.zone_prob:.0%} → 위치가 아직 불확실해 30초 더 관찰",
                           "caution", tr.meta_id, {"gain": round(gain, 3), "loss": round(loss, 3)})

    def _score(self, tr: Track, loc: LocationResult, t: float) -> tuple[int, list[dict[str, Any]]]:
        dur = t - (tr.inside_since or t) + settings.window_seconds
        use = tr.usage
        # 위험 점수 모델 입력 (설계안 9장 항목) -> 정밀 수색에서 기기가 나올 확률 x 100
        x = [tr.p_in, 0.8 if use else KIND_WEIGHT[tr.kind], min(1.0, dur / 120), 1.0 if tr.first_t > 0 else 0.0,
             RISK.get(use[0], 0.0) * use[1] if use and use[0] != "idle" else 0.0, min(1.0, tr.bursts / 3) if tr.bursts >= 2 else 0.0,
             float("approach_off" in tr.flags), float("rotate" in tr.flags), float("spoof" in tr.flags)]
        model = self.models.score(x)
        if model is not None:
            score, contrib = model
            habit_pts = dict(zip(["끊어 보내기", "접근 반응", "주소 변경", "허용 기기"], contrib[5:]))
            p = dict(zip(["교실 안", "기기 종류", "지속", "새 등장", "통신 용도"], contrib[:5]))
            return score, self._evidence(tr, loc, dur, p, habit_pts, "AI 위험 점수 모델")
        use_pts = 20.0 * use[1] if use and use[0] != "idle" else 0.0
        p = {
            "교실 안": 25.0 * tr.p_in,
            "기기 종류": 16.0 if use else 20 * KIND_WEIGHT[tr.kind],
            "지속": 20 * min(1.0, dur / 120),
            "새 등장": 15.0 if tr.first_t > 0 else 0.0,
            "통신 용도": use_pts,
        }
        rule_habit = {"끊어 보내기": min(15, 5 * tr.bursts), "접근 반응": 15, "주소 변경": 10, "허용 기기": 20}
        ev = self._evidence(tr, loc, dur, p, rule_habit, "규칙 점수 (위험 점수 모델 없음)")
        score = int(round(sum(p.values()) + sum(e["points"] for e in ev if e.get("habit"))))
        return score, ev

    def _evidence(self, tr: Track, loc: LocationResult, dur: float, p: dict[str, float], habit_pts: dict[str, float],
                  how: str) -> list[dict[str, Any]]:
        """근거 카드 항목. points = 이 항목이 위험 점수에 보탠 몫 (모델: 계수 x 값을 점수에 비례 배분)."""
        use = tr.usage
        # 우회 행동 근거 (v11 10장): 끊어 보내기 · 접근 시 끄기 · 주소 자주 바꾸기 · 허용 기기 위장
        habit: list[dict[str, Any]] = []
        if tr.bursts >= 2:
            habit.append({"label": "끊어 보내기", "value": f"이번 시험에서 {tr.bursts + 1}번 나눠 잡힘, 누적 {int(tr.seen_sec)}초", "source": "시험 중 누적",
                          "points": round(habit_pts["끊어 보내기"]), "habit": True})
        if "approach_off" in tr.flags:
            habit.append({"label": "접근 반응", "value": "휴대형이 다가오자 신호가 꺼졌다가 다시 켜짐", "source": "순회 기록",
                          "points": round(habit_pts["접근 반응"]), "habit": True})
        if "rotate" in tr.flags:
            habit.append({"label": "주소 변경", "value": "1분에 여러 번 신호 ID(주소)를 바꿈, 비정상적으로 잦음", "source": "AI 기기 묶기 모델",
                          "points": round(habit_pts["주소 변경"]), "habit": True})
        if "spoof" in tr.flags:
            habit.append({"label": "허용 기기", "value": "입실 전 자리와 다른 좌석 쪽에서 잡힘, 위장 의심", "source": "입실 전 세기 패턴 대조",
                          "points": round(habit_pts["허용 기기"]), "habit": True})
        seats = range_seats(loc.zone, loc.method == "AI 3대용")
        top2 = sorted(loc.zone_probs.items(), key=lambda kv: -kv[1])[:2]
        ai = loc.method  # "AI" · "AI 3대용" · "규칙 (장비 이상)" · "규칙 (모델 오류)" -> 근거 카드 출처에 그대로 표시
        rule = not ai.startswith("AI")
        ev = [
            {"label": "교실 안", "value": f"확률 {tr.p_in:.0%}, {loc.inside_reason}",
             "source": f"규칙 점수 ({ai[4:-1]})" if rule else f"{ai} 안/밖 모델",
             "points": round(p["교실 안"])},
            {"label": "추정 위치", "value": f"{range_name(loc.zone)} ({seat_text(seats)}) {loc.zone_prob:.0%}"
             + (f", 2순위 {range_name(top2[1][0])} {top2[1][1]:.0%}" if len(top2) > 1 and top2[1][1] > 0 else "")
             + f", {mmss(tr.zn * settings.window_seconds)} 측정", "source": f"규칙 점수 ({ai[4:-1]})" if rule else f"{ai} 위치 모델", "points": None},
        ]
        if use:
            ev.append({"label": "통신 용도", "value": f"Wi-Fi {USAGE_LABEL[use[0]]} {use[1]:.0%}", "source": "AI 용도 모델",
                       "points": round(p["통신 용도"])})
            ev.append({"label": "기기 종류", "value": "블루투스와 Wi-Fi가 함께 잡힘 → 휴대폰이나 카메라 안경 계열", "source": "블루투스와 Wi-Fi 신호 조합",
                       "points": round(p["기기 종류"])})
        elif tr.kind_method == "AI":
            ev.append({"label": "기기 종류", "value": f"{KIND_LABEL[tr.kind]} {tr.kind_p:.0%} (블루투스 신호 특징으로 추정)",
                       "source": "AI 종류 모델", "points": round(p["기기 종류"])})
        else:
            ev.append({"label": "기기 종류", "value": f"{KIND_LABEL[tr.kind]} 추정 (블루투스 신호 간격으로)",
                       "source": "신호 간격 규칙", "points": round(p["기기 종류"])})
        ev += [
            {"label": "지속 시간", "value": f"교실 안에서 {mmss(dur)} 연속", "source": how, "points": round(p["지속"])},
            {"label": "처음 잡힌 때", "value": "휴대폰 수거 뒤 새로 나타남" if tr.first_t > 0 else "입실 전부터 있던 신호", "source": how,
             "points": round(p["새 등장"])},
        ]
        ev += habit
        return ev

    def _counter(self, tr: Track) -> list[str]:
        """반대 근거 · 이 판단이 틀릴 수 있는 이유 (v10)."""
        loc = tr.loc
        out = [f"교실 밖일 가능성 {1 - tr.p_in:.0%}"]
        if loc:
            top2 = sorted(loc.zone_probs.items(), key=lambda kv: -kv[1])[:2]
            if len(top2) > 1 and top2[0][1] - top2[1][1] < 0.15:
                out.append(f"1순위와 2순위 범위 가능성이 비슷함 ({top2[0][1]:.0%} vs {top2[1][1]:.0%}) → 2순위 범위도 확인")
            if loc.method == "AI 3대용":
                out.append("수신기 1대가 끊겨 3대로 위치를 계산함 (범위를 넓게 봄)")
            elif loc.method == "규칙 (모델 오류)":
                out.append("위치 모델 이상으로 규칙으로 계산함 (정확도 낮음)")
            elif loc.method != "AI":
                out.append("수신기 고장 중이라 위치가 덜 정확함")
        if "hold" in tr.flags:
            out.append("비슷한 기기가 있어 다른 기기 신호와 섞였을 수 있음")
        out.append("통신 용도는 Wi-Fi 신호 패턴으로 추정한 것" if tr.usage
                   else f"기기 종류는 블루투스 신호 특징으로 추정한 것 ({tr.kind_p:.0%})" if tr.kind_method == "AI"
                   else "기기 종류는 블루투스 신호 간격으로 추정한 것")
        return out

    @staticmethod
    def _sig(tr: Track) -> str:
        return f"{tr.meta.get('company')}/{tr.meta.get('interval')}"

    async def _request(self, tr: Track, t: float, level: int, ev: list[dict[str, Any]]) -> None:
        loc = tr.loc
        z = loc.zone
        top2 = sorted(loc.zone_probs.items(), key=lambda kv: -kv[1])[:2]
        z2 = top2[1] if len(top2) > 1 and top2[1][1] > 0 else (None, None)
        parts = SEARCH_PARTS.get(tr.kind) if tr.kind != "unknown" else parts_by_signal(tr.usage is not None)
        steps = [{"label": "조사 기록", "value": s["clock"][:5] + " " + s["message"], "source": s["stage"], "points": None}
                 for s in tr.steps]
        with Session(engine) as s:
            req = s.get(SearchRequest, tr.request_id) if tr.request_id else None
            if req is None:
                req = SearchRequest(session_id=self.session_id, device_id=tr.meta_id, zone=z, seats=range_seats(z, loc.method == "AI 3대용"),
                                    score=tr.score, kind=KIND_LABEL[tr.kind], evidence=[], search_parts=parts, sim_time=t)
            req.level, req.score, req.zone, req.seats = level, tr.score, z, range_seats(z, loc.method == "AI 3대용")
            req.zone_prob, req.zone2 = round(loc.zone_prob, 2), z2[0]
            req.zone2_prob = round(z2[1], 2) if z2[1] else None
            req.evidence, req.counter, req.kind, req.search_parts = ev + steps, self._counter(tr), KIND_LABEL[tr.kind], parts
            s.add(req)
            s.commit()
            s.refresh(req)
        tr.request_id, tr.level = req.id, level
        tr.status = "approach" if level == 2 else "requested"
        if level == 2:
            await self.log(t, "수색", f"휴대형 접근 요청, {range_name(z)} ({seat_text(req.seats)}), 위험 {tr.score}점", "alert",
                           tr.meta_id, {"request_id": req.id})
        else:
            who = f"{req.suspect_seat}번 좌석" if req.suspect_seat else range_name(z)
            n = sum(1 for e in ev if (e.get("points") or 0) >= 10)
            await self.log(t, "수색", f"정밀 수색 요청, {who}, 위험 {tr.score}점 (기준 점수 이상이 30초 계속, 근거 {n}개)", "alert",
                           tr.meta_id, {"request_id": req.id})
        await self.emit("request", req.model_dump(mode="json"))

    # ---------- 수색 결과 (v10 미발견 처리 규칙) ----------
    async def learn(self, req: SearchRequest, found: bool, t: float) -> str:
        """발견 = 정답. 미발견은 신호 상태로 판정. 반환: found | second | unresolved | not_found."""
        tr = self.tracks.get(req.device_id)
        if found:
            if tr:
                tr.status = "resolved"
            self.review.append({"request_id": req.id, "result": "found", "device_id": req.device_id})
            await self.log(t, "결과 반영", f"기기 발견, {req.found_seat or '-'}번 → 정답으로 기록", "done", req.device_id)
            return "found"
        signal_on = tr is not None and t - tr.last_inside <= 30
        if signal_on and req.level < 4:
            await self.log(t, "결과 반영", "못 찾았는데 신호가 계속 잡힘 → 2차 수색 요청 (소지품, 책상, 다른 부위)", "alert",
                           req.device_id)
            return "second"
        if signal_on:
            if tr:
                tr.status = "resolved"
            self.review.append({"request_id": req.id, "result": "unresolved", "device_id": req.device_id})
            await self.log(t, "결과 반영", "2차 수색에서도 못 찾음, 신호는 계속 → 미해결로 기록, 시험 후 관리자가 검토", "caution", req.device_id)
            return "unresolved"
        self.allow[req.device_id] = "수색 후 미발견 (신호 사라짐)"
        if tr:
            tr.status = "resolved"
        self.review.append({"request_id": req.id, "result": "not_found", "device_id": req.device_id})
        await self.log(t, "결과 반영", "못 찾았고 신호도 사라짐 → 잘못 잡은 신호(오탐)로 기록", "done", req.device_id)
        return "not_found"

    async def allow_manual(self, meta_id: str, label: str, t: float) -> None:
        """감독관이 직접 허용 목록에 올림 (예: 감독관 본인 폰 · 시험장 장비). 이후 이 기기는 묶기만 하고 조사하지 않음."""
        self.allow[meta_id] = label
        tr = self.tracks.get(meta_id)
        if tr:
            tr.status, tr.level = "resolved", 0
        await self.log(t, "준비", f"감독관이 허용 목록에 추가, {label}, 확인 끝", "done", meta_id)

    def snapshot(self) -> list[dict[str, Any]]:
        out = []
        for tr in self.tracks.values():
            if tr.status in ("outside", "new", "resolved"):
                continue
            if tr.loc is None or "noloc" in tr.flags:  # 수신기 2대 이상 끊김: 있다는 것만 (구역 없음)
                if "noloc" in tr.flags:
                    out.append({"device_id": tr.meta_id, "status": tr.status, "level": tr.level, "score": tr.score, "zone": None,
                                "zone_prob": None, "zone2": None, "zone2_prob": None, "kind": KIND_LABEL[tr.kind],
                                "request_id": tr.request_id, "hold": tr.hold is not None, "no_location": True})
                continue
            top2 = sorted(tr.loc.zone_probs.items(), key=lambda kv: -kv[1])[:2]
            out.append({"device_id": tr.meta_id, "status": tr.status, "level": tr.level, "score": tr.score, "zone": tr.loc.zone,
                        "zone_prob": round(tr.loc.zone_prob, 2), "zone2": top2[1][0] if len(top2) > 1 else None,
                        "zone2_prob": round(top2[1][1], 2) if len(top2) > 1 else None, "kind": KIND_LABEL[tr.kind],
                        "request_id": tr.request_id, "hold": tr.hold is not None})
        return out
