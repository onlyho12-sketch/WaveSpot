"""증거 신뢰성 · 추가만 되는 기록 + 해시 체인 (설계안 v11 10장).

판단 기록 · 수색 결과 · 감독관 의견이 쌓일 때마다 앞 기록의 해시를 이어 붙임:
  body_hash = sha256(기록 내용 JSON)   hash = sha256(prev_hash + body_hash)
한 줄이라도 고치거나 지우면 그 뒤 해시가 모두 어긋남. 시험 종료 때 마지막 해시를 감독관 확인서 · 기관 시스템에
따로 적어 두면, 서버를 장악해 체인 전체를 다시 써도 그 값과 달라 들킴.
"""
import hashlib
import json
import threading
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, func, select

from app.models import AgentEvent, ChainEntry, SupervisorNote

GENESIS = "0" * 64
_lock = threading.Lock()  # 판단 기록(이벤트 루프)과 의견 등록(작업 스레드)이 동시에 붙여도 순서가 꼬이지 않게


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def canonical(body: dict[str, Any]) -> str:
    return json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def event_body(e: AgentEvent) -> dict[str, Any]:
    return {"sim_time": float(e.sim_time), "device_id": e.device_id, "stage": e.stage, "level": e.level, "message": e.message}


def note_body(n: SupervisorNote) -> dict[str, Any]:
    return {"sim_time": float(n.sim_time), "text": n.text}


def append(s: Session, session_id: int, kind: str, ref_id: int, body: dict[str, Any]) -> ChainEntry:
    """같은 DB 세션 안에서 체인에 한 줄 추가 (commit 은 호출한 쪽)."""
    with _lock:
        last = s.exec(select(ChainEntry).where(ChainEntry.session_id == session_id).order_by(ChainEntry.seq.desc())).first()
        prev, seq = (last.hash, last.seq + 1) if last else (GENESIS, 1)
        bh = _sha(canonical(body))
        entry = ChainEntry(session_id=session_id, seq=seq, kind=kind, ref_id=ref_id, body=body, body_hash=bh,
                           prev_hash=prev, hash=_sha(prev + bh))
        s.add(entry)
        s.flush()
        return entry


def verify(s: Session, session_id: int) -> dict[str, Any]:
    """체인을 처음부터 다시 계산. 판단 기록 · 의견은 원래 표의 지금 내용과도 대조 (원본을 고쳐도 들킴)."""
    rows = s.exec(select(ChainEntry).where(ChainEntry.session_id == session_id).order_by(ChainEntry.seq)).all()
    events = {e.id: e for e in s.exec(select(AgentEvent).where(AgentEvent.session_id == session_id))}
    notes = {n.id: n for n in s.exec(select(SupervisorNote).where(SupervisorNote.session_id == session_id))}
    prev, broken = GENESIS, None
    for r in rows:
        bh = _sha(canonical(r.body))
        if r.prev_hash != prev or r.body_hash != bh or r.hash != _sha(prev + bh):
            broken = {"seq": r.seq, "kind": r.kind, "reason": "해시가 이어지지 않음 (기록이 바뀌었거나 빠짐)"}
            break
        src = events.get(r.ref_id) if r.kind == "event" else notes.get(r.ref_id) if r.kind == "note" else None
        if r.kind in ("event", "note"):
            now = (event_body(src) if r.kind == "event" else note_body(src)) if src else None
            if now is None or canonical(now) != canonical(r.body):
                broken = {"seq": r.seq, "kind": r.kind, "reason": "원본 기록이 체인에 담긴 내용과 다름 (사후 수정 · 삭제)"}
                break
        prev = r.hash
    n_events = s.exec(select(func.count()).select_from(AgentEvent).where(AgentEvent.session_id == session_id)).one()
    chained = sum(1 for r in rows if r.kind == "event")
    if broken is None and chained < n_events:
        broken = {"seq": None, "kind": "event", "reason": f"체인에 없는 판단 기록 {n_events - chained}건 (나중에 끼워 넣음)"}
    return {
        "ok": broken is None,
        "count": len(rows),
        "last_hash": rows[-1].hash if rows else None,
        "last_seq": rows[-1].seq if rows else 0,
        "broken": broken,
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }
