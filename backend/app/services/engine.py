"""실시간 처리 엔진: 입력(재생 또는 MQTT) -> 10초 창 집계 -> 에이전트 -> WebSocket.

재생 모드 = 근거 기반 모의 데이터 데모 (v10). 시험 시간을 replay_speed 배속으로 진행, 입실 전 20분 기준선은 즉시 계산.
MQTT 모드 = 실제 수신기 측정값 (server/mqtt · docs/API.md).
"""
import asyncio
import contextlib
import json
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, select

from app.agent.agent import Agent, clock
from app.agent.kinds import SECOND_SEARCH_PARTS
from app.core.config import settings
from app.core.db import engine as db
from app.ml.sim import NODES
from app.models import AllowedDevice, ExamSession, SearchRequest
from app.realtime.hub import hub
from app.services.readings import Reading, WindowBuffer
from app.services.replay import SCENARIOS, Replay

BASELINE_SECONDS = 1200  # 입실 전 20분


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

    # ---------- 세션 ----------
    def load_or_create(self) -> ExamSession:
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
        if settings.source == "replay":
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
            for r in self.replay.readings_at(self.t):
                buf.add(r)
                self.meter.add(r)
            down = self.replay.node_down(self.t)  # 수신기 상태 신호 (실기기: wavespot/rooms/{node}/status)
            self.t += 1
            if self.t % win == 0:
                ok = set(NODES) - {down}
                self.meter.roll(self.nodes, win)
                if self._set_nodes(ok) or self.t % 60 == 0:  # 장비 점검 표는 1분마다 갱신
                    await self.broadcast_status()
                await self.agent.process(buf.flush(), self.t, nodes_ok=len(ok))
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
                        buf.add(r)
                        self.meter.add(r)
                if self.t - last >= settings.window_seconds:
                    last = self.t
                    ok = sum(1 for n in NODES if self.nodes.get(n, {}).get("status") == "online")
                    self.meter.roll(self.nodes, settings.window_seconds)
                    await self.broadcast_status()  # 실제 수신기: 10초마다 점검 표 갱신
                    await self.agent.process(buf.flush(), self.t, nodes_ok=ok)
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
        await self.agent.log(self.t, "수색", f"휴대형 순회 끝 · 가장 강하게 들린 좌석 {best}번 → {'정밀 수색 대상' if r.level >= 3 else '위험 점수가 70점 이상으로 30초 계속되면 정밀 수색 요청'}",
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
        }

    async def broadcast_status(self) -> None:
        await hub.send("status", self.status())


engine = Engine()


@contextlib.asynccontextmanager
async def lifespan_engine():
    engine.load_or_create()
    try:
        yield
    finally:
        engine.stop()
