"""실시간 처리 엔진: 입력(재생 또는 MQTT) -> 10초 창 집계 -> 에이전트 -> WebSocket.

재생 모드 = 근거 기반 모의 데이터 데모 (v10). 시험 시간을 replay_speed 배속으로 진행, 입실 전 20분 기준선은 즉시 계산.
MQTT 모드 = 실제 수신기 측정값 (server/mqtt · docs/API.md).
"""
import asyncio
import contextlib
import json
import shutil
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlmodel import Session, select

from app.agent.agent import Agent, clock
from app.agent.kinds import SECOND_SEARCH_PARTS
from app.core.config import settings
from app.core.db import engine as db
from app.ml.sim import NODES
from app.models import AccessLog, AgentEvent, AllowedDevice, AttackRun, ExamSession, FaultRecord, SearchRequest
from app.realtime.hub import hub
from app.services import integrity
from app.services.attacks import CATALOG as ATTACKS
from app.services.faults import CATALOG, INJECT_DOWN, Active
from app.services.readings import Reading, WindowBuffer
from app.services.replay import SCENARIOS, Replay, SimDevice

BASELINE_SECONDS = 1200  # 입실 전 20분
RETENTION_DAYS = 7  # 원시 신호 보관 기간 (이의 제기 기간 안)
NODE_TIMEOUT = 15  # 5초 주기 상태 신호를 15초 못 받으면 끊김
CLOCK_LIMIT_MS = 200
CHECKPOINT = settings.db_path.parent / "checkpoint.json"
NEW_DEVICE_LIMIT = 4  # 1분에 새 기기가 이만큼 이상 나타나면 이상 (주소를 자주 바꾸는 기기 의심)


def impossible(rssi: dict[str, float]) -> str | None:
    """수신기 4대 값이 물리적으로 맞지 않는 조합인가 (천장 2.7 m · 교실 9.1 x 8.5 m 에서 나올 수 없는 세기).
    모의 경로손실로 가장 가까워도 약 -78 dBm, 대각선 두 모서리가 함께 강할 수 없음."""
    strong = [n for n, v in rssi.items() if v > -50]
    if strong:
        return f"{' · '.join(strong)} {max(rssi.values()):.0f} dBm (천장 수신기에서 나올 수 없는 세기)"
    for a, b in (("R1", "R4"), ("R2", "R3")):
        if rssi.get(a, -100) > -70 and rssi.get(b, -100) > -70:
            return f"대각선 {a} · {b} 가 함께 {rssi[a]:.0f} · {rssi[b]:.0f} dBm (한 기기에서 동시에 나올 수 없음)"
    return None


class NodeMeter:
    """수신기 점검 표: 창마다 수신기별 받은 신호 수(초당) · 들린 기기 수.
    실제로 받은 측정값만 셈 (지연 · 비콘 세기처럼 지금 측정하지 않는 값은 만들지 않음)."""

    def __init__(self) -> None:
        self.count: Counter[str] = Counter()
        self.devs: dict[str, set[str]] = defaultdict(set)

    def add(self, r: Reading) -> None:
        self.count[r.node_id] += 1
        self.devs[r.node_id].add(r.device_id)

    def roll(self, nodes: dict[str, dict[str, Any]], seconds: float) -> None:
        for n, v in nodes.items():
            v.update(rate=round(self.count[n] / seconds, 1), heard=len(self.devs[n]))
        self.count.clear()
        self.devs.clear()


class Engine:
    def __init__(self) -> None:
        self.session: ExamSession | None = None
        self.agent: Agent | None = None
        self.replay: Replay | None = None
        self.t = -BASELINE_SECONDS
        self.speed = settings.replay_speed
        self.paused = False
        self.task: asyncio.Task | None = None
        self.walk_task: asyncio.Task | None = None
        self.nodes: dict[str, dict[str, Any]] = {n: {"node_id": n, "status": "offline", "last_seen": None, "rate": None, "heard": None} for n in NODES}
        self.meter = NodeMeter()
        self.beacon_ok = False
        # v11 10장 · 장애 대응
        self.active: dict[str, Active] = {}  # 지금 진행 중인 장애
        self.forced_down: dict[str, float] = {}  # 재현으로 끊은 수신기 -> 끝나는 시각
        self.node_fault: Active | None = None
        self.node_injected = False
        self.local_store = 0  # 망 장애 동안 수신기 자체 저장 공간에 쌓인 측정값
        self.checkpoint_at: float | None = None
        self.app_started = 0.0
        # v11 10장 · 우회 · 해킹 대응
        self.walking: set[str] = set()  # 휴대형 순회 중인 메타기기
        self.rejected = 0  # 거부한 측정값 (등록 안 된 수신기 · 불가능한 조합)
        self.new_times: list[float] = []
        self.auto_walk: str | None = None  # '접근 시 끄기' 재현: 요청이 나오면 휴대형 순회를 자동으로 시작

    # ---------- 세션 ----------
    def load_or_create(self) -> ExamSession:
        self.purge_old()
        with Session(db) as s:
            cur = s.exec(select(ExamSession).order_by(ExamSession.id.desc())).first()
            if cur is None or cur.state != "setup":  # 서버를 다시 켜면 새 교시로 시작 (재생 상태는 이어갈 수 없음)
                if cur and cur.state != "ended":
                    cur.state = "ended"
                    s.add(cur)
                cur = ExamSession(name="3교시 수학", scenario="demo")
                s.add(cur)
                s.commit()
                s.refresh(cur)
        self.attach(cur)
        return cur

    def attach(self, sess: ExamSession) -> None:
        self.session = sess
        self.agent = Agent(sess.id, hub.send, sess.exam_start_label)
        self.agent.on_detect = self._on_detect
        self.walking, self.rejected, self.new_times, self.auto_walk = set(), 0, [], None
        self.active, self.forced_down, self.node_fault, self.local_store, self.checkpoint_at = {}, {}, None, 0, None
        if settings.source == "replay":
            # 재생 모드의 수신기 자가 점검 값 (시계 차 · 펌웨어 서명 · 인증서). 실기기는 상태 토픽으로 보고
            for n, skew in zip(NODES, (8, 14, 11, 19)):
                self.nodes[n].update(skew_ms=skew, fw_ok=True, cert_ok=True)
            self.replay = Replay(sess.scenario)
            self._set_nodes(set(NODES))
            self.beacon_ok = True
            # 장비 확인용 첫 10초 측정 (본 재생과 난수를 나누지 않도록 별도 인스턴스)
            probe = Replay(sess.scenario, seed=101)
            for t in range(-BASELINE_SECONDS, -BASELINE_SECONDS + int(settings.window_seconds)):
                for r in probe.readings_at(t):
                    self.meter.add(r)
            self.meter.roll(self.nodes, settings.window_seconds)
        self.t = -BASELINE_SECONDS

    def _set_nodes(self, ok: set[str]) -> bool:
        changed = False
        for n, v in self.nodes.items():
            st = "online" if n in ok else "offline"
            changed |= v["status"] != st
            v.update(status=st, last_seen=datetime.now().isoformat() if n in ok else v["last_seen"])
        return changed

    def new_session(self, name: str, scenario: str, rows: int, cols: int) -> ExamSession:
        self.stop()
        with Session(db) as s:
            for old in s.exec(select(ExamSession).where(ExamSession.state != "ended")):
                old.state = "ended"
                s.add(old)
            sess = ExamSession(name=name, scenario=scenario if scenario in SCENARIOS else "demo", rows=rows, cols=cols)
            s.add(sess)
            s.commit()
            s.refresh(sess)
        self.attach(sess)
        return sess

    @staticmethod
    def purge_old() -> int:
        """이의 제기 기간(7일)이 지난 교시의 원시 신호(수신기 세기 · 순회 세기)를 지움. 판단 기록 · 결과 · 해시 체인은 남김."""
        cut = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
        n = 0
        with Session(db) as s:
            for sess in s.exec(select(ExamSession).where(ExamSession.created_at < cut)):
                for e in s.exec(select(AgentEvent).where(AgentEvent.session_id == sess.id)):
                    if e.data is not None:
                        e.data = None
                        s.add(e)
                        n += 1
                for r in s.exec(select(SearchRequest).where(SearchRequest.session_id == sess.id)):
                    if r.walk is not None:
                        r.walk = None
                        s.add(r)
                        n += 1
            s.commit()
        return n

    def _save_state(self, state: str) -> None:
        assert self.session
        with Session(db) as s:
            sess = s.get(ExamSession, self.session.id)
            sess.state = state
            s.add(sess)
            s.commit()
            s.refresh(sess)
            self.session = sess

    # ---------- 입실 전 기준선 ----------
    async def baseline(self) -> list[dict[str, str]]:
        """입실 전 20분 동안 들린 신호를 메타기기로 묶어 허용 목록에 등록 (주소가 바뀐 기기도 1대로)."""
        assert self.session and self.agent
        if self.replay:
            buf = WindowBuffer()
            for t in range(-BASELINE_SECONDS, 0):
                for r in self.replay.readings_at(t):
                    buf.add(r)
                    self.meter.add(r)
                if (t + 1) % settings.window_seconds == 0:
                    self.agent.baseline_window(buf.flush(), t + 1)
                    self.meter.roll(self.nodes, settings.window_seconds)
        self.agent.finish_baseline()  # 허용 기기의 입실 전 자리 지문
        added = []
        with Session(db) as s:
            for mid, m in self.agent.linker.metas.items():
                if mid in self.agent.allow:
                    continue
                label = f"기준선 기기 {len(self.agent.allow) + 1} · 주소 {len(m.sources)}개"
                s.add(AllowedDevice(session_id=self.session.id, device_id=mid, label=label, reason="baseline"))
                self.agent.allow[mid] = label
                added.append({"device_id": mid, "label": label})
            s.commit()
        self._save_state("baseline")
        self.t = 0.0
        n_addr = sum(len(m.sources) for m in self.agent.linker.metas.values())
        await self.agent.log(-1, "준비", f"입실 전 20분 동안 잡힌 기기 {len(added)}대를 허용 목록에 등록 (주소 {n_addr}개) · 오늘 교실에 맞춰 기준 조정")
        await self.broadcast_status()
        return added

    # ---------- 시험 진행 ----------
    def start(self) -> None:
        assert self.session
        if self.session.state != "running":
            self._save_state("running")
        self.paused = False
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._run_replay() if settings.source == "replay" else self._run_mqtt())

    def stop(self) -> None:
        for task in (self.task, self.walk_task):
            if task and not task.done():
                task.cancel()
        self.task = self.walk_task = None

    async def _run_replay(self) -> None:
        assert self.session and self.agent and self.replay
        buf = WindowBuffer()
        end = self.session.duration_min * 60
        win = settings.window_seconds
        await self.agent.log(self.t, "준비", "시험 시작 · 수신기 4대로 교실 전체 감시 중 (녹화 재생 · 근거 기반 모의 데이터)")
        while self.t < end:
            if self.paused:
                await asyncio.sleep(0.2)
                continue
            down = self._down_now()  # 수신기 상태 신호 (실기기: wavespot/rooms/{node}/status)
            network = "network" in self.active
            for r in self.replay.readings_at(self.t):
                if r.node_id in down:
                    continue
                if not await self._trusted(r):
                    continue
                if network:  # 망 장애: 서버에 닿지 않고 수신기 자체 저장 공간에 쌓임
                    self.local_store += 1
                    self.active["network"].missed += 1
                    continue
                if "server" in self.active:
                    self.active["server"].resent += 1  # 재시작 동안 수신기가 보관했다가 다시 보냄 (MQTT QoS 1)
                buf.add(r)
                self.meter.add(r)
            self.t += 1
            await self._fault_tick()
            if self.t % win == 0:
                ok = set(NODES) - down
                self.meter.roll(self.nodes, win)
                changed = self._set_nodes(ok)
                await self._observe_nodes(down)
                if changed or self.t % 60 == 0:  # 장비 점검 표는 1분마다 갱신
                    await self.broadcast_status()
                if "server" not in self.active and "network" not in self.active:
                    # 재시작 · 망 장애 중에는 판단하지 않음 (재시작 뒤 보관분을 한 번에 판단)
                    windows = await self._plausible(buf.flush())
                    before = set(self.agent.tracks)
                    await self.agent.process(windows, self.t, nodes_ok=len(ok), down=sorted(down), walking=self.walking)
                    await self._new_device_surge(set(self.agent.tracks) - before)
                    await self._auto_walk()
                    self._checkpoint()
            if self.t % 5 == 0:
                await hub.send("clock", self.clock_payload())
            await asyncio.sleep(0 if self.speed >= 1000 else 1 / max(self.speed, 0.1))  # 1000배 이상은 시험용
        self._save_state("ended")
        await self.agent.log(self.t, "준비", "시험 종료 · 기록 화면에서 결과 확인")
        await hub.send("clock", self.clock_payload())

    async def _run_mqtt(self) -> None:
        """실제 수신기 (브로커 필요). paho 클라이언트를 별도 스레드에서 돌려 큐로 넘김
        -> Windows(Proactor 이벤트 루프) · 리눅스(라즈베리파이) 모두 동작."""
        import paho.mqtt.client as mqtt

        assert self.agent
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue()
        root = settings.mqtt_topic_root
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="wavespot-server")

        def on_connect(c, _u, _f, rc, _p=None):
            c.subscribe([(f"{root}/devices/+/+", 0), (f"{root}/rooms/+/status", 0)])

        client.on_connect = on_connect
        client.on_message = lambda _c, _u, m: loop.call_soon_threadsafe(q.put_nowait, (m.topic, bytes(m.payload)))
        client.connect(settings.mqtt_host, settings.mqtt_port)
        client.loop_start()
        await self.agent.log(0, "준비", f"실제 수신기 모드 · MQTT {settings.mqtt_host}:{settings.mqtt_port} 연결")
        buf = WindowBuffer()
        t0 = time.monotonic()
        last = 0.0
        heard_at: dict[str, float] = {}
        try:
            while True:
                try:
                    topic, payload = await asyncio.wait_for(q.get(), timeout=1.0)
                except TimeoutError:
                    topic = None
                self.t = time.monotonic() - t0
                if topic:
                    parts = topic.split("/")
                    if parts[1] == "rooms":
                        self.nodes.setdefault(parts[2], {"node_id": parts[2]}).update(
                            status=payload.decode(), last_seen=datetime.now().isoformat())
                        await self.broadcast_status()
                    elif parts[1] == "devices" and len(parts) == 4:
                        p = json.loads(payload)
                        r = Reading(self.t, parts[2], parts[3], float(p["rssi"]), {k: v for k, v in p.items() if k != "rssi"})
                        if await self._trusted(r):
                            buf.add(r)
                            self.meter.add(r)
                if topic and parts[1] == "devices":
                    heard_at[parts[3]] = self.t
                if self.t - last >= settings.window_seconds:
                    last = self.t
                    # 생존 신호: 15초 동안 아무것도 못 받은 수신기는 끊김으로 봄
                    for n in NODES:
                        v = self.nodes.setdefault(n, {"node_id": n})
                        if v.get("status") == "online" and self.t - heard_at.get(n, self.t) > NODE_TIMEOUT:
                            v["status"] = "offline"
                    down = {n for n in NODES if self.nodes.get(n, {}).get("status") != "online"}
                    self.meter.roll(self.nodes, settings.window_seconds)
                    await self._observe_nodes(down)
                    await self.broadcast_status()  # 실제 수신기: 10초마다 점검 표 갱신
                    await self.agent.process(await self._plausible(buf.flush()), self.t, nodes_ok=len(NODES) - len(down), down=sorted(down),
                                             walking=self.walking)
                    self._checkpoint()
                    await hub.send("clock", self.clock_payload())
        finally:
            client.loop_stop()
            client.disconnect()

    # ---------- 수색 ----------
    async def start_search(self, req: SearchRequest, again: bool = False, zones: list[int] | None = None, dwell: int = 2) -> None:
        """zones: 감독관이 정한 순회 경로(구역 순서) · dwell: 좌석당 머무는 초"""
        assert self.agent
        tr = self.agent.tracks.get(req.device_id)
        route = [z for z in dict.fromkeys(zones or []) if 1 <= z <= 8]
        if route:
            await self.agent.log(self.t, "수색", f"휴대형 순회 시작 (감독관이 정한 경로) · {' → '.join(f'{z}구역' for z in route)} · 좌석마다 {dwell}초",
                                 "caution", req.device_id)
            if self.replay and tr and (self.walk_task is None or self.walk_task.done()):
                walked = sorted(set((req.walk or {}).get("zones", []))) if req.level == 4 else None
                self.walk_task = asyncio.create_task(self._walk(req, tr.addr, route, walked, dwell))
        elif req.level == 4:
            # 2차 수색 · 휴대형 재접근: 아직 돌지 않은 구역 중 에이전트가 누적한 구역 확률이 높은 순 2곳
            walked = set((req.walk or {}).get("zones", []))
            probs = tr.loc.zone_probs if tr and tr.loc else {}
            rest = sorted((z for z in range(1, 9) if z not in walked), key=lambda z: -probs.get(z, 0.0))
            zones = rest[:2]
            await self.agent.log(self.t, "수색", f"2차 휴대형 순회 · 아직 안 돈 구역 중 가능성 높은 순 {' → '.join(f'{z}구역' for z in zones)}",
                                 "caution", req.device_id)
            if self.replay and tr and (self.walk_task is None or self.walk_task.done()):
                self.walk_task = asyncio.create_task(self._walk(req, tr.addr, zones, sorted(walked)))
        elif req.level == 2 or req.suspect_seat is None or again:
            zones = [req.zone] + ([req.zone2] if req.zone2 else [])
            await self.agent.log(self.t, "수색", f"휴대형 순회 {'다시 ' if again else ''}시작 · {' → '.join(f'{z}구역' for z in zones)} · 좌석마다 2초",
                                 "caution", req.device_id)
            if self.replay and tr and (self.walk_task is None or self.walk_task.done()):
                self.walk_task = asyncio.create_task(self._walk(req, tr.addr, zones))
        else:
            await self.agent.log(self.t, "수색", f"정밀 수색 시작 · {req.suspect_seat}번 · 금속탐지기로 {', '.join(req.search_parts[:2])} 확인",
                                 "caution", req.device_id)

    async def _walk(self, req: SearchRequest, addr: str, zones: list[int], walked_before: list[int] | None = None, dwell: int = 2) -> None:
        """순회하는 동안 대상 기기를 '순회 중'으로 표시 (그동안 신호가 사라지면 접근 반응 근거)."""
        assert self.replay
        self.walking.add(req.device_id)
        self.replay.walking.add(addr)
        try:
            await self._walk_run(req, addr, zones, walked_before, dwell)
        finally:
            self.walking.discard(req.device_id)
            self.replay.walking.discard(addr)

    async def _walk_run(self, req: SearchRequest, addr: str, zones: list[int], walked_before: list[int] | None = None, dwell: int = 2) -> None:
        """재생 모드 휴대형 순회 (v10 검증 ⑤ 모의). 실기기에선 wavespot/handheld/... 로 수신."""
        assert self.replay
        from app.ml.features import seats_of_zone

        result: dict[str, Any] = {}
        for zi, z in enumerate(zones):
            for step in self.replay.walk(seats_of_zone(z), addr, dwell):
                if step.get("done"):
                    for k, v in step["seat_medians"].items():
                        result[k] = max(result.get(k, -999.0), v)
                    continue
                level = "far" if step["rel_db"] < -10 else ("near" if step["rel_db"] < -4 else "nearest")
                await hub.send("handheld", {"request_id": req.id, "zone": z, "zones": zones, "zone_index": zi, "dwell": dwell, "level": level, **step})
                await asyncio.sleep(0 if self.speed >= 1000 else 0.25)  # 좌석마다 2초 (0.25초 x 8건)
        best = max(result, key=result.get) if result else None
        with Session(db) as s:
            r = s.get(SearchRequest, req.id)
            r.walk = {"seat_medians": {str(k): v for k, v in result.items()}, "best_seat": best,
                      "zones": sorted(set(walked_before or []) | set(zones))}
            r.suspect_seat = best
            if r.state == "searching":
                r.state = "open"
            s.add(r)
            s.commit()
            s.refresh(r)
        await hub.send("handheld", {"request_id": req.id, "done": True, "best_seat": best, "seat_medians": result})
        await self.agent.log(self.t, "수색", f"휴대형 순회 끝 · 신호가 가장 강했던 좌석 {best}번 → {'정밀 수색 대상' if r.level >= 3 else '위험 점수가 기준 이상으로 30초 계속되면 정밀 수색 요청'}",
                             "caution", req.device_id, {"seat_medians": {str(k): v for k, v in result.items()}})
        await hub.send("request", r.model_dump(mode="json"))

    async def allow_device(self, meta_id: str, label: str) -> list[SearchRequest]:
        """감독관 허용 목록 추가: 기록 · 에이전트 반영, 열린 요청은 '허용 등록'으로 닫음."""
        assert self.session and self.agent
        closed: list[SearchRequest] = []
        with Session(db) as s:
            if not s.exec(select(AllowedDevice).where(AllowedDevice.session_id == self.session.id, AllowedDevice.device_id == meta_id)).first():
                s.add(AllowedDevice(session_id=self.session.id, device_id=meta_id, label=label, reason="manual"))
            for r in s.exec(select(SearchRequest).where(SearchRequest.session_id == self.session.id, SearchRequest.device_id == meta_id,
                                                        SearchRequest.state.in_(("open", "searching")))):
                r.state, r.resolved_at = "allowed", datetime.now(timezone.utc)
                s.add(r)
                closed.append(r)
            s.commit()
            for r in closed:
                s.refresh(r)
        await self.agent.allow_manual(meta_id, label, self.t)
        for r in closed:
            await hub.send("request", r.model_dump(mode="json"))
        await hub.send("devices", self.agent.snapshot())
        await self.broadcast_status()
        return closed

    async def resolve(self, req: SearchRequest, found: bool) -> SearchRequest:
        """v10 미발견 처리 규칙: 신호가 계속되면 Lv4 2차 수색 · 학습 보류."""
        assert self.agent
        outcome = await self.agent.learn(req, found, self.t)
        with Session(db) as s:
            r = s.get(SearchRequest, req.id)
            if outcome == "second":
                r.level, r.state, r.search_parts = 4, "open", SECOND_SEARCH_PARTS
                r.counter = ["1차 수색에서 못 찾음 · 같은 신호가 계속 잡힘"] + (r.counter or [])
            else:
                r.state = outcome
            s.add(r)
            s.flush()
            integrity.append(s, r.session_id, "result", r.id, {
                "request_id": r.id, "found": found, "found_seat": r.found_seat, "outcome": outcome, "level": req.level,
                "note": r.note, "sim_time": float(self.t)})
            s.commit()
            s.refresh(r)
        if found and self.replay:
            tr = self.agent.tracks.get(req.device_id)
            if tr:
                self.replay.confiscate(tr.addr, self.t)
        await hub.send("request", r.model_dump(mode="json"))
        await hub.send("devices", self.agent.snapshot())
        return r

    # ---------- 상태 ----------
    def clock_payload(self) -> dict[str, Any]:
        s = self.session
        return {"t": self.t, "clock": clock(max(self.t, 0), s.exam_start_label if s else "09:00"),
                "minute": int(max(self.t, 0) // 60), "duration_min": s.duration_min if s else 100,
                "state": s.state if s else "setup", "paused": self.paused, "speed": self.speed}

    def status(self) -> dict[str, Any]:
        s = self.session
        return {
            "session": s.model_dump(mode="json") if s else None,
            "source": settings.source,
            "simulated": settings.source == "replay",
            "scenario_title": SCENARIOS.get(s.scenario, {}).get("title") if s else None,
            "nodes": list(self.nodes.values()),
            "beacon_ok": self.beacon_ok,
            "allowlist": [{"device_id": k, "label": v} for k, v in (self.agent.allow.items() if self.agent else [])],
            "stats": self.agent.stats if self.agent else None,
            "clock": self.clock_payload(),
            "health": self.health(),
            "selfcheck": self.selfcheck(),
        }

    async def broadcast_status(self) -> None:
        await hub.send("status", self.status())

    # ---------- 자가 점검 · 장애 대응 (v11 10장) ----------
    def selfcheck(self) -> list[dict[str, Any]]:
        """시험 시작 전 자가 점검. ok=False 가 하나라도 있으면 '감시 시작' 불가. ok=None 은 보고 없음 (막지 않음)."""
        nodes = [self.nodes.get(n, {}) for n in NODES]
        online = sum(1 for v in nodes if v.get("status") == "online")
        skews = [v["skew_ms"] for v in nodes if v.get("skew_ms") is not None]
        fw = [v["fw_ok"] for v in nodes if v.get("fw_ok") is not None]
        cert = [v["cert_ok"] for v in nodes if v.get("cert_ok") is not None]
        try:
            free = shutil.disk_usage(settings.db_path.parent).free / 1e9
        except (AttributeError, OSError):  # 웹 시연판(브라우저 메모리 DB)은 디스크 정보가 없음
            free = 1.0
        if self.agent:  # 위치(4대용 · 3대용 4개) · 안/밖 · 용도 + 종류 · 묶기 · 점수 · 이상 감지
            loaded, need = self.agent.locator.models_loaded()
            loaded, need = loaded + self.agent.models.loaded(), need + len(self.agent.models.FILES)
        else:
            loaded, need = 0, 11
        no_report = "수신기 보고 없음"
        return [
            {"key": "nodes", "label": "수신기 연결", "value": f"{online}/{len(NODES)}대", "ok": online == len(NODES)},
            {"key": "beacon", "label": "기준 비콘", "value": "수신 중" if self.beacon_ok else "끊김", "ok": self.beacon_ok},
            {"key": "clock", "label": "시계 동기화", "value": f"최대 {max(skews)}ms 차이 · 기준 {CLOCK_LIMIT_MS}ms" if skews else no_report,
             "ok": (max(skews) <= CLOCK_LIMIT_MS) if skews else None},
            {"key": "storage", "label": "저장 공간", "value": f"여유 {free:.0f}GB", "ok": free >= 1},
            {"key": "firmware", "label": "수신기 펌웨어 서명", "value": f"{sum(fw)}/{len(fw)}대 확인" if fw else no_report,
             "ok": all(fw) if fw else None},
            {"key": "cert", "label": "수신기 인증서", "value": f"{sum(cert)}/{len(cert)}대 확인" if cert else no_report,
             "ok": all(cert) if cert else None},
            {"key": "models", "label": "AI 모델 파일", "value": f"{loaded}/{need}개 불러옴", "ok": loaded >= 3},
        ]

    def selfcheck_ok(self) -> bool:
        return all(c["ok"] is not False for c in self.selfcheck())

    def _down_now(self) -> set[str]:
        down = {n for n, until in self.forced_down.items() if self.t < until}
        if self.replay and (d := self.replay.node_down(self.t)):
            down.add(d)
        return down

    def health(self) -> dict[str, Any]:
        down = [n for n in NODES if self.nodes.get(n, {}).get("status") != "online"]
        ok = len(NODES) - len(down)
        running = bool(self.session and self.session.state == "running")
        mode = ("manual" if "network" in self.active else "recovering" if "server" in self.active
                else "no_location" if running and ok <= 2 else "degraded" if running and ok == 3 else "normal")
        start = self.session.exam_start_label if self.session else "09:00"
        return {
            "mode": mode,
            "nodes_ok": ok,
            "down": down,
            "beacon": "frozen" if "beacon" in self.active else "ok" if self.beacon_ok else "off",
            "model_rule": bool(self.agent and self.agent.locator.broken),
            "result_fail": "result" in self.active,
            "locked": running,
            "local_store": self.local_store,
            "checkpoint": clock(self.checkpoint_at, start) if self.checkpoint_at is not None else None,
            "active": [{"kind": a.kind, "title": CATALOG[a.kind].title, "screen": CATALOG[a.kind].screen,
                        "since": clock(max(a.started, 0), start), "injected": a.injected} for a in self.active.values()],
        }

    def _checkpoint(self) -> None:
        """10초마다 상태 저장 (기준선 · 허용 목록 · 조사 진행 · 대응 단계). 서버가 다시 켜지면 여기서 이어서 판단."""
        if not (self.agent and self.session):
            return
        snap = {"session_id": self.session.id, "t": self.t, "allow": self.agent.allow, "review": self.agent.review,
                "tracks": {k: {"level": v.level, "status": v.status, "score": v.score, "request_id": v.request_id}
                           for k, v in self.agent.tracks.items() if v.status not in ("outside", "new")},
                "stats": self.agent.stats}
        try:
            tmp = CHECKPOINT.with_suffix(".tmp")
            tmp.write_text(json.dumps(snap, ensure_ascii=False), encoding="utf-8")
            tmp.replace(CHECKPOINT)
            self.checkpoint_at = self.t
        except OSError:
            pass

    def _open_fault(self, kind: str, injected: bool, until: float | None) -> Active:
        assert self.session
        spec = CATALOG[kind]
        with Session(db) as s:
            rec = FaultRecord(session_id=self.session.id, kind=kind, title=spec.title, action=spec.action, started=self.t,
                              target_sec=spec.target_sec, injected=injected)
            s.add(rec)
            s.commit()
            s.refresh(rec)
        return Active(rec.id, kind, self.t, until, injected)

    def _close_fault(self, a: Active, recover_sec: float | None = None) -> float:
        took = recover_sec if recover_sec is not None else self.t - a.started
        with Session(db) as s:
            rec = s.get(FaultRecord, a.record_id)
            if rec:
                rec.ended, rec.missed, rec.recover_sec = self.t, a.missed, round(took, 1)
                s.add(rec)
                s.commit()
        return took

    async def inject(self, kind: str) -> None:
        """관리 화면의 장애 재현 (재생 모드 · 시험 중). 검증 실험 7: 복구 시간 · 놓친 신호 수 측정."""
        assert self.agent and self.session
        spec = CATALOG[kind]
        if kind in self.active or (kind in INJECT_DOWN and self.node_fault):
            return
        if kind in INJECT_DOWN:
            # 끊김 기록은 _observe_nodes 가 생존 신호로 감지해서 남김
            for n in INJECT_DOWN[kind]:
                self.forced_down[n] = self.t + spec.dur
            self.node_injected = True
            return
        a = self._open_fault(kind, True, self.t + spec.dur)
        self.active[kind] = a
        t = self.t
        if kind == "server":
            when = clock(self.checkpoint_at, self.session.exam_start_label) if self.checkpoint_at is not None else "-"
            await self.agent.log(t, "장비", f"현장 서버 재시작 감지 · 자동 재시작 중 · 마지막 저장 상태({when})로 이어서 판단", "alert")
        elif kind == "model":
            self.agent.locator.broken = True
            await self.agent.log(t, "장비", "위치 모델 출력 이상 (범위 · 결측 검사 실패) · 이 모델만 건너뛰고 규칙 점수로 판단", "caution",
                                 data={"calls": [], "skipped": ["위치"]})
        elif kind == "network":
            await self.agent.log(t, "장비", "시험장 망 끊김 · 수신기와 서버 연결 상실 → 감시 중단, 수동 감독 모드 · 수신기는 자체 저장 공간에 계속 기록", "alert")
        elif kind == "beacon":
            self.beacon_ok = False
            await self.agent.log(t, "장비", "기준 비콘 세기 급변 · 세기 보정 정지, 직전 보정값으로 계속 판단", "caution")
        elif kind == "clock":
            self.nodes["R1"]["skew_ms"] = 350
            await self.agent.log(t, "장비", f"수신기 R1 시각 차 350ms (기준 {CLOCK_LIMIT_MS}ms 초과) · 내부 시간 서버로 재동기화, 그동안 R1 가중치 낮춤", "caution")
        elif kind == "result":
            await self.agent.log(t, "장비", "수색 결과 저장 확인 응답 없음 · 태블릿에 먼저 저장하고 연결되면 전송", "caution")
        elif kind == "app":
            a.until = None
            self.app_started = time.monotonic()
            await self.agent.log(t, "장비", "감독관 앱 연결 끊김 (WebSocket 응답 없음) · 자동 재연결 중 · 그동안 휴대형 수신기 진동 · LED로 알림", "caution")
            await hub.drop_all(spec.dur)
        await self.broadcast_status()

    async def _fault_tick(self) -> None:
        """끝난 장애를 닫고 복구를 기록."""
        if not self.agent or not self.active:
            return
        for kind, a in list(self.active.items()):
            if kind == "app":
                # 화면이 다시 붙으면 복구. 아무 화면도 안 켜져 있으면 끊김이 끝난 뒤 30초 지나 닫음
                if hub.in_outage() or (not hub.clients and time.monotonic() - hub.outage_until < 30):
                    continue
                took = self._close_fault(a, time.monotonic() - self.app_started)
                del self.active[kind]
                await self.agent.log(self.t, "장비", f"감독관 앱 다시 연결 · {took:.0f}초 만에 복구 (목표 10초) · 놓친 알림 다시 보냄", "info")
                await self.broadcast_status()
                continue
            if a.until is None or self.t < a.until:
                continue
            took = self._close_fault(a)
            del self.active[kind]
            if kind == "server":
                await self.agent.log(self.t, "장비", f"현장 서버 복구 · {took:.0f}초 (목표 30초 이내) · 수신기가 보관한 측정값 {a.resent}건 재전송받아 이어서 판단", "info")
            elif kind == "model":
                self.agent.locator.broken = False
                await self.agent.log(self.t, "장비", "위치 모델 다시 불러옴 · AI 판단으로 복귀", "info")
            elif kind == "network":
                stored, self.local_store = self.local_store, 0
                await self.agent.log(self.t, "장비", f"시험장 망 복구 · 감시 재개 · 수신기 자체 저장분 {stored}건 동기화 → 사후 리포트에 반영", "info")
            elif kind == "beacon":
                self.beacon_ok = True
                await self.agent.log(self.t, "장비", "기준 비콘 정상 · 세기 보정 다시 시작", "info")
            elif kind == "clock":
                self.nodes["R1"]["skew_ms"] = 9
                await self.agent.log(self.t, "장비", f"수신기 R1 재동기화 완료 · 시각 차 9ms · {took:.0f}초", "info")
            elif kind == "result":
                await self.agent.log(self.t, "장비", "결과 저장 응답 정상 · 대기 중인 결과는 앱이 자동으로 전송", "info")
            await self.broadcast_status()

    async def _observe_nodes(self, down: set[str]) -> None:
        """수신기 끊김을 장애 기록으로 남김 (시나리오 고장 · 재현 · 실기기 모두)."""
        if not self.session or self.session.state != "running":
            return
        if down and self.node_fault is None:
            kind = "node2" if len(down) >= 2 else "node1"
            self.node_fault = self._open_fault(kind, self.node_injected, None)
        elif down and self.node_fault and len(down) >= 2 and self.node_fault.kind == "node1":
            with Session(db) as s:
                rec = s.get(FaultRecord, self.node_fault.record_id)
                if rec:
                    rec.kind, rec.title, rec.action = "node2", CATALOG["node2"].title, CATALOG["node2"].action
                    s.add(rec)
                    s.commit()
            self.node_fault.kind = "node2"
        elif not down and self.node_fault:
            self._close_fault(self.node_fault)
            self.node_fault = None
            self.node_injected = False

    # ---------- 우회 · 해킹 대응 (v11 10장) ----------
    async def _trusted(self, r: Reading) -> bool:
        """등록된 수신기(R1~R4 · 인증서 있음)의 값만 받음. 나머지는 거부하고 처음 한 번 경보."""
        if r.node_id in NODES:
            return True
        self.rejected += 1
        if self.agent:
            await self.agent.detect("fake", None, self.t, f"등록 안 된 수신기 {r.node_id}의 데이터 거부")
            if ("log", r.node_id) not in self.agent.detected:
                self.agent.detected.add(("log", r.node_id))
                await self.agent.log(self.t, "보안", f"인증서 없는 수신기 '{r.node_id}'가 측정값을 보냄 → 받지 않고 거부 (가짜 측정값 주입 의심)", "alert")
        return False

    async def _plausible(self, windows: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        """수신기 4대 값이 물리적으로 맞지 않는 기기는 판단에서 빼고 경보."""
        out = {}
        for addr, w in windows.items():
            why = impossible(w["rssi"])
            if why is None:
                out[addr] = w
                continue
            self.rejected += 1
            if self.agent and ("bad", addr) not in self.agent.detected:
                self.agent.detected.add(("bad", addr))
                await self.agent.log(self.t, "보안", f"물리적으로 맞지 않는 측정값 조합 · {why} → 판단에서 빼고 경보", "alert")
                await self.agent.detect("fake", None, self.t, why)
        return out

    async def _new_device_surge(self, new: set[str]) -> None:
        """'새 기기 등장'이 1분에 비정상적으로 많으면 그 자체를 이상 신호로 봄 (주소를 아주 자주 바꾸는 기기)."""
        if not self.agent:
            return
        self.new_times = [x for x in self.new_times if self.t - x <= 60] + [self.t] * len(new)
        if len(self.new_times) >= NEW_DEVICE_LIMIT and self.t - getattr(self, "_surge_at", -1e9) > 600:
            self._surge_at = self.t
            await self.agent.log(self.t, "보안", f"1분 동안 새 기기 {len(self.new_times)}대 등장 · 평소보다 비정상적으로 많음 → 주소를 아주 자주 바꾸는 기기 의심, 관찰 강화", "caution")
            await self.agent.detect("rotate", None, self.t, f"1분에 새 기기 {len(self.new_times)}대")

    async def _auto_walk(self) -> None:
        """'접근 시 끄기' 재현: 이 기기에 요청이 나오면 감독관 역할로 휴대형 순회를 시작."""
        if not (self.auto_walk and self.agent) or (self.walk_task and not self.walk_task.done()):
            return
        for tr in self.agent.tracks.values():
            if tr.addr.startswith(self.auto_walk + "-") and tr.request_id and tr.status in ("approach", "requested"):
                with Session(db) as s:
                    req = s.get(SearchRequest, tr.request_id)
                    if req is None or req.state != "open":
                        return
                    req.state = "searching"
                    s.add(req)
                    s.commit()
                    s.refresh(req)
                await hub.send("request", req.model_dump(mode="json"))
                self.auto_walk = None
                await self.start_search(req)
                return

    async def _on_detect(self, kind: str, meta_id: str | None, t: float, detail: str) -> None:
        """탐지 기록: 재현 중인 같은 종류가 있으면 그 기록에 탐지 시각을 채우고, 없으면 실제 탐지로 새로 남김."""
        assert self.session
        with Session(db) as s:
            run = s.exec(select(AttackRun).where(AttackRun.session_id == self.session.id, AttackRun.kind == kind,
                                                 AttackRun.detected_at.is_(None)).order_by(AttackRun.id)).first()
            if run is None:
                run = AttackRun(session_id=self.session.id, kind=kind, title=ATTACKS[kind].title if kind in ATTACKS else kind,
                                injected=False, started=t)
            run.detected_at, run.detail, run.device_id = t, detail, meta_id or run.device_id
            s.add(run)
            s.commit()

    async def inject_attack(self, kind: str) -> None:
        """우회 · 해킹 재현 (설계안 20장 실험 8 · 재생 모드 · 시험 중 · 관리자)."""
        assert self.agent and self.session and self.replay
        t = self.t
        with Session(db) as s:
            s.add(AttackRun(session_id=self.session.id, kind=kind, title=ATTACKS[kind].title, started=t))
            s.commit()
        if kind == "burst":  # 25초 보내고 25초 쉬기를 반복, 보낼 때마다 주소도 바꿈
            self.replay.add_device(SimDevice(f"atk-burst{int(t)}", "끊어 보내는 이어폰", 12, t + 1, t + 1 + 400, duty=(25, 50), rotate=50,
                                             meta={"company": "0x004C", "interval": 100}))
            msg = "부정행위자 역할: 12번 좌석 이어폰이 25초씩 끊어 보냄 (기준 점수 바로 아래로 유지)"
        elif kind == "approach_off":  # 사진 전송 휴대폰 · 휴대형 순회가 시작되면 끔
            base = f"atk-evade{int(t)}"
            self.replay.add_device(SimDevice(base, "다가오면 끄는 휴대폰", 24, t + 1, t + 1 + 1200, meta={"company": "0x0075", "interval": 200},
                                             wifi=[(t + 1, 9e9, "photo_send")], evade=True))
            self.auto_walk = base
            msg = "부정행위자 역할: 24번 좌석 휴대폰이 사진을 보내다가, 휴대형 순회가 시작되면 끔 (요청이 나오면 자동으로 순회 시작)"
        elif kind == "spoof":
            self.replay.move("desk-phone", 33)
            msg = "부정행위자 역할: 입실 전 교탁에서 켜 둔(허용 목록에 오른) 휴대폰을 33번 좌석에서 씀 (정상 기기 위장)"
        elif kind == "rotate":  # 12초마다 주소 변경
            self.replay.add_device(SimDevice(f"atk-rotate{int(t)}", "주소를 자주 바꾸는 이어폰", 5, t + 1, t + 1 + 300, rotate=15,
                                             meta={"company": "0x004C", "interval": 45}))
            msg = "부정행위자 역할: 5번 좌석 이어폰이 15초마다 주소를 바꿈"
        elif kind == "fake":
            self.replay.fake_until = t + 60
            msg = "외부 조력자 역할: 인증서 없는 수신기 R9 · 불가능한 세기의 측정값을 60초 동안 주입"
        elif kind == "ap":
            msg = "외부 조력자 역할: 시험장 밖에서 수신기 전용 AP에 접속 시도"
            await self.agent.log(t, "보안", "수신기 전용 AP에 인증서 없는 기기가 접속 시도 (WPA3 · 수신기 인증서 없음) → 차단 · 새 Wi-Fi 기기로 경보", "alert")
            await self.agent.detect("ap", None, t, "인증서 없는 기기의 AP 접속 차단")
        elif kind == "account":
            msg = "외부 조력자 역할: 탈취한 관리자 계정으로 시험 중 허용 목록 · 기준값 변경 시도"
            with Session(db) as s:
                for path in ("/api/allowlist", "/api/settings/thresholds"):
                    s.add(AccessLog(session_id=self.session.id, role="admin", method="POST", path=path, action="변경", status=423, allowed=False))
                s.commit()
            await self.agent.log(t, "보안", "관리자 계정으로 시험 중 허용 목록 · 기준값 변경 시도 → 시험 중 잠금으로 거부, 접근 기록에 남김", "alert")
            await self.agent.detect("account", None, t, "허용 목록 · 기준값 변경 2건 거부 (잠금)")
        else:
            msg = kind
        await self.agent.log(t, "보안", f"[재현] {msg}", "info")  # 재현 기기는 몇 분 뒤 꺼져 다른 재현과 섞이지 않음
        await self.broadcast_status()

    def attack_runs(self) -> list[dict[str, Any]]:
        """재현 · 탐지 기록 + 탐지된 기기가 오른 사다리 최고 단계."""
        assert self.session
        start = self.session.exam_start_label
        out = []
        with Session(db) as s:
            runs = s.exec(select(AttackRun).where(AttackRun.session_id == self.session.id).order_by(AttackRun.id)).all()
            for r in runs:
                level = None
                if r.device_id:
                    lv = [q.level for q in s.exec(select(SearchRequest).where(SearchRequest.session_id == r.session_id,
                                                                                SearchRequest.device_id == r.device_id))]
                    tr = self.agent.tracks.get(r.device_id) if self.agent else None
                    level = max(lv + ([tr.level] if tr else [])) if (lv or tr) else None
                out.append({**r.model_dump(mode="json"), "clock": clock(max(r.started, 0), start),
                            "detected_clock": clock(max(r.detected_at, 0), start) if r.detected_at is not None else None,
                            "took": round(r.detected_at - r.started) if r.detected_at is not None else None, "level": level})
        return out


engine = Engine()


@contextlib.asynccontextmanager
async def lifespan_engine():
    engine.load_or_create()
    try:
        yield
    finally:
        engine.stop()
