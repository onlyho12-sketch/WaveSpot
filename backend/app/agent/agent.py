"""WaveSpot AI 에이전트 (설계안 v10 9장).

판단 순서 : 신호 감지(기기 연결 · 교실 안/밖 · 30초 연속) -> 위치 추정(구역 · 종류/용도 · 점수) -> 수색(휴대형 · 정밀 수색)
수색 강화 사다리 (애매하면 사람에게 넘기지 않고 더 세게 확인)
  Lv0 감시        허용 목록 밖 신호 없음
  Lv1 추가 관찰   점수 40 이상인데 '더 볼 때 얻는 것 > 잃는 것', 또는 묶기 보류 -> 30초 더 관찰
  Lv2 휴대형 접근 얻는 것 <= 잃는 것, 또는 Wi-Fi 영상 · 사진 전송 패턴 -> 반쪽 줄 구역 안내
  Lv3 정밀 수색   70점 이상 30초 연속 + 근거 2개 이상 -> 의심 부정행위자(좌석) 지정, 금속탐지기
  Lv4 2차 수색    Lv3 미발견인데 같은 신호가 계속됨 -> 다른 부위 · 소지품 · 책상, 학습 보류
상황마다 필요한 모델만 부르고, 부른 모델 · 건너뛴 모델을 기록 (파이프라인 대비 호출 수 비교).
"""
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field, replace
from typing import Any

from sqlmodel import Session

from app.agent.kinds import KIND_LABEL, KIND_WEIGHT, SEARCH_PARTS, guess_kind, parts_by_signal
from app.agent.linking import Linker
from app.core.config import settings
from app.core.db import engine
from app.ml.features import seats_of_zone
from app.ml.location import LocationResult, Locator
from app.ml.wifi_sim import LABEL as USAGE_LABEL, RISK
from app.models import AgentEvent, SearchRequest

Emit = Callable[[str, Any], Awaitable[None]]
MODELS = ["묶기", "안/밖", "위치", "종류", "용도", "점수"]  # 파이프라인은 창마다 기기마다 6개 모두 실행


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
    usage: tuple[str, float] | None = None
    meta: dict[str, Any] = field(default_factory=dict)
    loc: LocationResult | None = None
    flags: set[str] = field(default_factory=set)
    hold: dict[str, Any] | None = None  # 묶기 보류 {candidate, until}
    request_id: int | None = None
    steps: list[dict[str, Any]] = field(default_factory=list)
    zsum: dict[int, float] = field(default_factory=dict)
    zn: int = 0


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
        self.linker = Linker()
        self.allow: dict[str, str] = {}  # 메타기기 -> 설명
        self.tracks: dict[str, Track] = {}
        self.penalty: dict[str, int] = {}
        self.stats = {"windows": 0, "device_windows": 0, "agent_calls": 0, "pipeline_calls": 0}
        self.nodes_ok = 4

    # ---------- 기록 ----------
    async def log(self, t: float, stage: str, message: str, level: str = "info", meta_id: str | None = None,
                  data: dict | None = None) -> None:
        ev = AgentEvent(session_id=self.session_id, sim_time=t, device_id=meta_id, stage=stage, level=level,
                        message=message, data=data)
        with Session(engine) as s:
            s.add(ev)
            s.commit()
            s.refresh(ev)
        payload = ev.model_dump()
        payload["clock"] = clock(t, self.start_label)
        if meta_id and meta_id in self.tracks:
            self.tracks[meta_id].steps.append({"clock": payload["clock"], "stage": stage, "message": message})
        await self.emit("event", payload)

    def _calls(self, used: list[str]) -> dict[str, list[str]]:
        self.stats["agent_calls"] += len(used)
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

    # ---------- 창 단위 판단 ----------
    async def process(self, windows: dict[str, dict[str, Any]], t: float, nodes_ok: int = 4) -> None:
        await self._equipment(nodes_ok, t)
        self.stats["windows"] += 1
        active: set[str] = {m for a in windows if (m := self.linker.known(a))}
        for addr, w in windows.items():
            self.stats["device_windows"] += 1
            self.stats["pipeline_calls"] += len(MODELS)
            mid = self.linker.known(addr)
            if mid is None:
                mid = await self._link_new(addr, w, t, active)
                active.add(mid)
            self.linker.touch(mid, addr, w["meta"], w["rssi"], t)
            if mid in self.allow:
                self._calls(["묶기"])
                continue
            tr = self.tracks.get(mid)
            if tr is None:
                tr = self.tracks[mid] = Track(mid, first_t=t)
            tr.addr = addr
            tr.meta.update(w["meta"])
            await self._step(tr, w, t)
        await self.emit("devices", self.snapshot())
        await self.emit("stats", self.stats)

    async def _equipment(self, nodes_ok: int, t: float) -> None:
        if nodes_ok < 4 and self.nodes_ok == 4:
            await self.log(t, "장비", f"수신기 {nodes_ok}/4만 작동 · 남은 수신기로 위치를 대략 계산 (정확도 낮음)", "caution",
                           data={"calls": [], "skipped": ["위치"]})
        elif nodes_ok == 4 and self.nodes_ok < 4:
            await self.log(t, "장비", "수신기 4/4 복구 · 위치 계산 정상", "info")
        self.nodes_ok = nodes_ok

    async def _link_new(self, addr: str, w: dict, t: float, active: set[str]) -> str:
        cands = self.linker.candidates(addr, w["meta"], w["rssi"], t, active)
        kind, cand, sim, gap = self.linker.decide(cands)
        if kind == "link" and cand:
            if cand in self.allow:
                await self.log(t, "신호 감지", f"허용된 기기가 주소만 바꾼 것 (닮은 정도 {sim:.2f}) · 확인 끝",
                               "info", cand, self._calls(["묶기"]))
            elif cand in self.tracks:
                await self.log(t, "신호 감지", f"주소만 바뀐 같은 기기 (닮은 정도 {sim:.2f}) · 이어서 확인",
                               "info", cand, self._calls(["묶기"]))
            return cand
        mid = f"m-{addr}"
        if kind == "hold" and cand:
            tr = self.tracks[mid] = Track(mid, first_t=t)
            tr.hold = {"candidate": cand, "until": t + 30}
            tr.flags.add("hold")
            await self.log(t, "신호 감지", f"비슷한 기기가 여럿이라 같은 기기인지 아직 모름 (닮은 정도 차이 {gap:.2f}) · 30초 더 지켜봄",
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
                await self.log(t, "신호 감지", "30초 지켜본 결과 허용된 기기와 같은 기기 · 확인 끝", "info",
                               tr.meta_id, self._calls(["묶기"]))
                tr.status = "resolved"
                return
            await self.log(t, "신호 감지", "30초 지켜본 결과 다른 기기 · 새 기기로 계속 확인", "info", tr.meta_id, self._calls(["묶기"]))
        if tr.status in ("approach", "requested", "searching", "resolved"):
            loc = self.locator.locate(w["rssi"], self.nodes_ok)
            if loc.p_inside >= 0.5:
                tr.last_inside = t
            if tr.status != "resolved":
                tr.p_in = 0.6 * tr.p_in + 0.4 * loc.p_inside
                self._accumulate(tr, loc)
                self._calls(["묶기", "안/밖", "위치", "점수"])
                await self._escalate(tr, t)  # Lv2 -> Lv3 은 요청이 나간 뒤에도 계속 판단
            return

        # 1) 신호 감지 · 교실 안/밖
        loc = self.locator.locate(w["rssi"], self.nodes_ok)
        tr.p_in = 0.6 * tr.p_in + 0.4 * loc.p_inside
        if loc.p_inside < 0.5:
            tr.out_consec += 1
            if tr.status in ("observing", "caution") and tr.out_consec < need:
                self._calls(["묶기", "안/밖"])
                return
            calls = self._calls(["묶기", "안/밖"])
            if tr.status != "outside":
                await self.log(t, "신호 감지", f"교실 밖 신호 (교실 안 확률 {loc.p_inside:.0%}) · 확인 끝", "info", tr.meta_id, calls)
            tr.status, tr.consec, tr.high, tr.inside_since, tr.level = "outside", 0, 0, None, 0
            return
        tr.out_consec = 0
        tr.last_inside = t
        tr.consec += 1
        if tr.inside_since is None:
            tr.inside_since = t
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
                await self.log(t, "위치 추정", f"Wi-Fi로 데이터를 보내는 중 · {USAGE_LABEL[tr.usage[0]]}로 보임 ({tr.usage[1]:.0%}) · 기기 종류는 신호 조합으로 판단",
                               "caution", tr.meta_id, {"calls": ["용도", "위치", "점수"], "skipped": ["종류"]})
        else:
            tr.kind = guess_kind(tr.meta)
            used.append("종류")
        used.append("점수")
        calls = self._calls(used)
        score, ev = self._score(tr, loc, t)
        tr.score = score
        if tr.consec == need:
            await self.log(t, "신호 감지", f"{int(need * win)}초 연속 확인 → 숨은 기기 있음, {loc.zone}구역 추정 · 위험 {score}점", "caution",
                           tr.meta_id, calls)
        if score < settings.caution_score:
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
        tr.high = tr.high + 1 if score >= settings.request_score else 0
        n_evidence = sum(1 for e in ev if (e.get("points") or 0) >= 10)
        if tr.high >= need and n_evidence >= 2:
            if tr.level < 3:
                await self._request(tr, t, 3, ev)
            return
        if tr.status in ("approach", "requested", "searching"):
            return
        # Lv1 vs Lv2 · 기다림의 가치 vs 놓칠 위험
        if strong_usage or gain <= loss:
            why = (f"{USAGE_LABEL[tr.usage[0]]} 패턴 → 확신이 낮아도 바로" if strong_usage
                   else f"더 지켜보면 얻는 확신 {gain:.2f} ≤ 놓칠 위험 {loss:.2f}")
            await self.log(t, "위치 추정", f"{why} → 휴대형 접근 · {loc.zone}구역", "caution", tr.meta_id,
                           {"gain": round(gain, 3), "loss": round(loss, 3)})
            await self._request(tr, t, 2, ev)
            return
        tr.status, tr.level = "caution", 1
        if "lv1" not in tr.flags or tr.zn % 3 == 0:
            tr.flags.add("lv1")
            await self.log(t, "위치 추정", f"위험 {score}점 · 위치 확신 {loc.zone_prob:.0%} → 더 지켜보면 얻는 확신 {gain:.2f} > 놓칠 위험 {loss:.2f}, 30초 더 관찰",
                           "caution", tr.meta_id, {"gain": round(gain, 3), "loss": round(loss, 3)})

    def _score(self, tr: Track, loc: LocationResult, t: float) -> tuple[int, list[dict[str, Any]]]:
        dur = t - (tr.inside_since or t) + settings.window_seconds
        use = tr.usage
        use_pts = 20.0 * use[1] if use and use[0] != "idle" else 0.0
        p = {
            "교실 안": 25.0 * tr.p_in,
            "기기 종류": 16.0 if use else 20 * KIND_WEIGHT[tr.kind],
            "지속": 20 * min(1.0, dur / 120),
            "새 등장": 15.0 if tr.first_t > 0 else 0.0,
            "통신 용도": use_pts,
        }
        pen = self.penalty.get(self._sig(tr), 0)
        score = int(round(sum(p.values()) - pen))
        seats = seats_of_zone(loc.zone)
        top2 = sorted(loc.zone_probs.items(), key=lambda kv: -kv[1])[:2]
        ai = "AI" if loc.method == "AI" else loc.method
        ev = [
            {"label": "교실 안", "value": f"확률 {tr.p_in:.0%} · {loc.inside_reason}", "source": f"{ai} 안/밖 모델 · 모의 학습",
             "points": round(p["교실 안"])},
            {"label": "대략 구역", "value": f"{loc.zone}구역 ({seats[0]}~{seats[-1]}번) {loc.zone_prob:.0%}"
             + (f" · 2순위 {top2[1][0]}구역 {top2[1][1]:.0%}" if len(top2) > 1 and top2[1][1] > 0 else "")
             + f" · {tr.zn}개 창 누적", "source": f"{ai} 위치 모델 · 모의 학습", "points": None},
        ]
        if use:
            ev.append({"label": "통신 용도", "value": f"Wi-Fi {USAGE_LABEL[use[0]]} {use[1]:.0%}", "source": "AI 용도 모델 · 논문 수치 모의 학습",
                       "points": round(p["통신 용도"])})
            ev.append({"label": "기기 종류", "value": "블루투스와 Wi-Fi가 함께 잡힘 → 휴대폰 · 카메라 안경 계열", "source": "신호 조합 (종류 모델 건너뜀)",
                       "points": round(p["기기 종류"])})
        else:
            ev.append({"label": "기기 종류", "value": f"{KIND_LABEL[tr.kind]} 추정 (블루투스 신호 간격 {tr.meta.get('interval', '?')}ms)",
                       "source": "규칙 · 종류 모델 실측 전", "points": round(p["기기 종류"])})
        ev += [
            {"label": "지속 시간", "value": f"교실 안에서 {mmss(dur)} 연속", "source": "계산", "points": round(p["지속"])},
            {"label": "처음 잡힌 때", "value": "휴대폰 수거 뒤 새로 나타남" if tr.first_t > 0 else "입실 전부터 있던 신호", "source": "계산",
             "points": round(p["새 등장"])},
        ]
        if pen:
            ev.append({"label": "지난 결과", "value": f"같은 유형 기기를 수색했지만 없었음 → {pen}점 낮춤", "source": "수색 결과 학습", "points": -pen})
        return score, ev

    def _counter(self, tr: Track) -> list[str]:
        """반대 근거 · 이 판단이 틀릴 수 있는 이유 (v10)."""
        loc = tr.loc
        out = [f"교실 밖일 가능성 {1 - tr.p_in:.0%}"]
        if loc:
            top2 = sorted(loc.zone_probs.items(), key=lambda kv: -kv[1])[:2]
            if len(top2) > 1 and top2[0][1] - top2[1][1] < 0.15:
                out.append(f"1순위와 2순위 구역 가능성이 비슷함 ({top2[0][1]:.0%} vs {top2[1][1]:.0%}) → 2순위 구역도 확인")
            if loc.method != "AI":
                out.append("수신기 고장 중이라 위치가 덜 정확함")
        if "hold" in tr.flags:
            out.append("비슷한 기기가 있어 다른 기기 신호와 섞였을 수 있음")
        out.append("통신 용도 판단은 실제 시험장에서 아직 검증 전" if tr.usage else "기기 종류는 블루투스 신호 간격으로 추정한 것")
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
                req = SearchRequest(session_id=self.session_id, device_id=tr.meta_id, zone=z, seats=seats_of_zone(z),
                                    score=tr.score, kind=KIND_LABEL[tr.kind], evidence=[], search_parts=parts, sim_time=t)
            req.level, req.score, req.zone, req.seats = level, tr.score, z, seats_of_zone(z)
            req.zone_prob, req.zone2 = round(loc.zone_prob, 2), z2[0]
            req.zone2_prob = round(z2[1], 2) if z2[1] else None
            req.evidence, req.counter, req.kind, req.search_parts = ev + steps, self._counter(tr), KIND_LABEL[tr.kind], parts
            s.add(req)
            s.commit()
            s.refresh(req)
        tr.request_id, tr.level = req.id, level
        tr.status = "approach" if level == 2 else "requested"
        if level == 2:
            await self.log(t, "수색", f"휴대형 접근 요청 · {z}구역({req.seats[0]}~{req.seats[-1]}번) · 위험 {tr.score}점", "alert",
                           tr.meta_id, {"request_id": req.id})
        else:
            who = f"{req.suspect_seat}번 좌석" if req.suspect_seat else f"{z}구역"
            n = sum(1 for e in ev if (e.get("points") or 0) >= 10)
            await self.log(t, "수색", f"정밀 수색 요청 · {who} · 위험 {tr.score}점 (70점 이상이 30초 계속 · 근거 {n}개)", "alert",
                           tr.meta_id, {"request_id": req.id})
        await self.emit("request", req.model_dump(mode="json"))

    # ---------- 수색 결과 (v10 미발견 처리 규칙) ----------
    async def learn(self, req: SearchRequest, found: bool, t: float) -> str:
        """발견 = 정답. 미발견은 신호 상태로 판정. 반환: found | second | unresolved | not_found."""
        tr = self.tracks.get(req.device_id)
        if found:
            if tr:
                tr.status = "resolved"
            await self.log(t, "결과 반영", f"기기 발견 · {req.found_seat or '-'}번 → 다음 판단에 반영", "done", req.device_id)
            return "found"
        signal_on = tr is not None and t - tr.last_inside <= 30
        if signal_on and req.level < 4:
            await self.log(t, "결과 반영", "못 찾았는데 신호가 계속 잡힘 → 2차 수색 요청 (소지품 · 책상 · 다른 부위)", "alert",
                           req.device_id)
            return "second"
        if signal_on:
            if tr:
                tr.status = "resolved"
            await self.log(t, "결과 반영", "2차 수색에서도 못 찾음 · 신호는 계속 → 미해결로 기록, 시험 후 사람이 검토", "caution", req.device_id)
            return "unresolved"
        sig = self._sig(tr) if tr else "?"
        self.penalty[sig] = self.penalty.get(sig, 0) + 10
        self.allow[req.device_id] = "수색 후 미발견 · 신호 사라짐"
        if tr:
            tr.status = "resolved"
        await self.log(t, "결과 반영", "못 찾았고 신호도 사라짐 → 잘못 잡은 것으로 보고 같은 유형은 다음부터 10점 낮게", "done", req.device_id)
        return "not_found"

    async def allow_manual(self, meta_id: str, label: str, t: float) -> None:
        """감독관이 직접 허용 목록에 올림 (예: 감독관 본인 폰 · 시험장 장비). 이후 이 기기는 묶기만 하고 조사하지 않음."""
        self.allow[meta_id] = label
        tr = self.tracks.get(meta_id)
        if tr:
            tr.status, tr.level = "resolved", 0
        await self.log(t, "준비", f"감독관이 허용 목록에 추가 · {label} · 확인 끝", "done", meta_id)

    def snapshot(self) -> list[dict[str, Any]]:
        out = []
        for tr in self.tracks.values():
            if tr.status in ("outside", "new", "resolved") or tr.loc is None:
                continue
            top2 = sorted(tr.loc.zone_probs.items(), key=lambda kv: -kv[1])[:2]
            out.append({"device_id": tr.meta_id, "status": tr.status, "level": tr.level, "score": tr.score, "zone": tr.loc.zone,
                        "zone_prob": round(tr.loc.zone_prob, 2), "zone2": top2[1][0] if len(top2) > 1 else None,
                        "zone2_prob": round(top2[1][1], 2) if len(top2) > 1 else None, "kind": KIND_LABEL[tr.kind],
                        "request_id": tr.request_id, "hold": tr.hold is not None})
        return out
