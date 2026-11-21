// 기록 · 시험 후 리포트 (참고: Honorlock 세션 리뷰)
// 첫 줄: 종합 소견 3단 (수색 요청 / 관찰 / 이상 없음, 기기 기준) + 처리 결과
// 가운데: 트랙별 타임라인 (표시를 누르면 그 기록으로 이동)
// 아래: 수색 내역 표 (구역 · 감지 기기 · 처리 결과 · 근거 / 신호 기록 보기) · 감독관 의견 · 필터되는 판단 기록
// 결과 판단은 AI가 아니라 감독관 → '확정은 기기 발견 시'
// v11 10장: 기록 위변조 확인(해시 체인 · 확인서에 적을 마지막 값) · 리포트 내보내기 · 장애 · 복구 기록(시간순)
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useMemo, useState } from "react"
import { AgentLog } from "@/components/monitor/AgentLog"
import { EvidenceSheet, ScoreBadge, target } from "@/components/monitor/RequestCard"
import { ChainPanel, FaultLog } from "@/components/monitor/SystemPanels"
import { Axis, minuteStates, StateBand } from "@/components/monitor/StateTimeline"
import { Button } from "@/components/ui/button"
import { Panel, Status, Tag } from "@/components/ui/status"
import { api, type AgentEvent, type SearchRequest } from "@/lib/api"
import { useLive } from "@/lib/live"
import { clockOf, cn, DONE_LABEL, isOpen, type Tone } from "@/lib/utils"

const FILTERS = [
  { key: "main", label: "주요", test: (e: AgentEvent) => e.level === "alert" || e.level === "done" || ["결과 반영", "장비", "준비", "보안"].includes(e.stage) || e.message.includes("순회") },
  { key: "all", label: "전체", test: () => true },
  { key: "equip", label: "장비 · 보안", test: (e: AgentEvent) => e.stage === "장비" || e.stage === "준비" || e.stage === "보안" },
] as const

const TRACKS: { label: string; test: (e: AgentEvent) => boolean; cls: string }[] = [
  { label: "신호 감지", test: (e) => e.stage === "신호 감지", cls: "bg-fg-3" },
  { label: "관찰", test: (e) => e.stage === "위치 추정" || (e.stage === "수색" && e.level === "caution"), cls: "bg-warn-fill" },
  { label: "수색 요청", test: (e) => e.level === "alert", cls: "bg-danger" },
  { label: "결과", test: (e) => e.stage === "결과 반영" || e.level === "done", cls: "bg-ok" },
  { label: "장비", test: (e) => e.stage === "장비", cls: "bg-fg" },
  { label: "보안", test: (e) => e.stage === "보안" && !e.message.startsWith("[재현]"), cls: "bg-danger" },
]

export function Log() {
  const status = useLive((s) => s.status)
  const clock = useLive((s) => s.clock)
  const requestsMap = useLive((s) => s.requests)
  const events = useLive((s) => s.events)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("main")
  const [sel, setSel] = useState<number | null>(null)

  const requests = useMemo(() => Object.values(requestsMap).sort((a, b) => b.id - a.id), [requestsMap])
  const count = (s: string) => requests.filter((r) => r.state === s).length
  const start = status?.session?.exam_start_label ?? "09:00"
  const total = clock?.duration_min ?? 100
  const now = clock && (clock.state === "running" || clock.state === "ended") ? Math.min(total - 1, Math.floor(Math.max(clock.t, 0) / 60)) : -1
  const states = minuteStates(total, now, events, requests)
  const shown = events.filter(FILTERS.find((f) => f.key === filter)!.test)

  // 종합 소견: 시험 중 잡힌 기기를 한 번씩만 셈 (수색 요청 > 관찰 > 이상 없음)
  const summary = useMemo(() => {
    const seen = new Set<string>()
    const watched = new Set<string>()
    for (const e of events) {
      if (!e.device_id || e.sim_time < 0) continue
      seen.add(e.device_id)
      if (e.level === "caution" || e.level === "alert") watched.add(e.device_id)
    }
    const req = new Set(requests.map((r) => r.device_id))
    for (const d of req) seen.add(d)
    const watch = [...watched].filter((d) => !req.has(d)).length
    return { request: req.size, watch, clean: seen.size - req.size - watch }
  }, [events, requests])

  function pick(id: number) {
    setFilter("all")
    setSel(id)
    requestAnimationFrame(() => document.getElementById(`ev-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }))
  }

  /** 그 기기의 수색 요청 기록(없으면 첫 기록)으로 이동 */
  function showSignal(r: SearchRequest) {
    const mine = events.filter((e) => e.device_id === r.device_id)
    const ev = mine.find((e) => e.level === "alert") ?? mine[0]
    if (ev) pick(ev.id)
  }

  return (
    <div className="flex flex-col gap-3 medium:gap-4">
      {/* 종합 소견 */}
      <Panel title="종합 소견" aside={<span>이번 교시 · 기기 기준</span>}>
        <div className="grid expanded:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] expanded:divide-x divide-line">
          <div className="space-y-2 px-4 py-4 medium:px-5">
            <SummaryBar tone="danger" label="수색 요청" value={summary.request} max={Math.max(1, summary.request + summary.watch + summary.clean)} />
            <SummaryBar tone="warn" label="관찰" value={summary.watch} max={Math.max(1, summary.request + summary.watch + summary.clean)} />
            <SummaryBar tone="neutral" label="이상 없음" value={summary.clean} max={Math.max(1, summary.request + summary.watch + summary.clean)} />
          </div>
          <div className="grid grid-cols-3 divide-x divide-line border-t border-line expanded:border-t-0">
            <Big label="기기 발견" value={count("found")} />
            <Big label="미발견" value={count("not_found")} />
            <Big label="미해결" value={count("unresolved")} />
          </div>
        </div>
        {requests.length === 0 && summary.request + summary.watch + summary.clean === 0 && (
          <p className="border-t border-line px-5 py-2.5 text-fs13 text-fg-3">아직 잡힌 신호가 없습니다.</p>
        )}
      </Panel>

      {/* 트랙별 타임라인 */}
      <Panel title="교시 타임라인" bodyClass="px-4 py-4">
        <div className="grid grid-cols-[72px_1fr] items-center gap-x-3 gap-y-2 medium:grid-cols-[88px_1fr]">
          <span className="text-fs13 font-semibold">상태</span>
          <StateBand states={states} total={total} now={now} height="h-6" />
          {TRACKS.map((t) => (
            <Track key={t.label} label={t.label} total={total} cls={t.cls} events={events.filter((e) => e.sim_time >= 0 && t.test(e))} sel={sel} onPick={pick} />
          ))}
          <span />
          <Axis total={total} start={start} />
        </div>
      </Panel>

      {/* 수색 내역 표 */}
      <Panel title={<>수색 내역 <span className="num font-medium text-fg-3">{requests.length}</span></>}>
        {requests.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-fg-3">수색 요청 없음 · 정상 교시</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line bg-subtle text-left text-xs text-fg-3">
                <tr>
                  <th className="w-16 px-4 py-2 font-semibold">시각</th>
                  <th className="py-2 font-semibold">구역</th>
                  <th className="py-2 font-semibold">감지 기기</th>
                  <th className="w-14 py-2 text-center font-semibold">점수</th>
                  <th className="px-4 py-2 font-semibold">처리 결과</th>
                  <th className="w-[200px] py-2 pr-4 text-right font-semibold">보기</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {requests.map((r) => <RequestRow key={r.id} req={r} start={start} onSignal={() => showSignal(r)} />)}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <FaultLog sessionId={status?.session?.id ?? null} />

      <ChainPanel sessionId={status?.session?.id ?? null} />

      <div className="grid gap-3 medium:gap-4 expanded:grid-cols-[340px_minmax(0,1fr)] large:grid-cols-[400px_minmax(0,1fr)]">
        <Notes sessionId={status?.session?.id ?? null} />

        <Panel title="판단 기록">
          <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
            {FILTERS.map((f) => (
              <button key={f.key} role="tab" type="button" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
                className={cn("h-8 shrink-0 rounded-md px-3 text-fs13 font-semibold", filter === f.key ? "bg-fg text-white" : "text-fg-2 hover:bg-fg/5")}>
                {f.label}
              </button>
            ))}
          </div>
          <AgentLog events={shown} selected={sel} onSelect={setSel} />
        </Panel>
      </div>
    </div>
  )
}

const BAR: Record<"danger" | "warn" | "neutral", string> = { danger: "bg-danger", warn: "bg-warn-fill", neutral: "bg-fg-3/45" }

/** 종합 소견 한 줄 · 모양 + 색 + 글자 */
function SummaryBar({ tone, label, value, max }: { tone: "danger" | "warn" | "neutral"; label: string; value: number; max: number }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr_3rem] items-center gap-3">
      <Status tone={tone as Tone}><span className="text-fs15 font-semibold">{label}</span></Status>
      <div className="h-7 overflow-hidden rounded-md bg-subtle">
        <div className={cn("h-full rounded-md transition-[width]", BAR[tone])} style={{ width: `${value === 0 ? 0 : Math.max(4, (value / max) * 100)}%` }} />
      </div>
      <span className={cn("num text-right text-fs22 leading-none font-bold", tone === "danger" && value > 0 && "text-danger")}>{value}</span>
    </div>
  )
}

const RESULT_TONE: Record<string, Tone> = { found: "neutral", not_found: "neutral", unresolved: "warn" }

function RequestRow({ req, start, onSignal }: { req: SearchRequest; start: string; onSignal: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <tr className="align-middle">
      <td className="num px-4 py-2.5 text-fg-2">{clockOf(req.sim_time, start)}</td>
      <td className="py-2.5 font-semibold whitespace-nowrap">{req.found_seat ? `${req.found_seat}번 좌석` : target(req)}</td>
      <td className="py-2.5 whitespace-nowrap text-fg-2">{req.kind} 추정</td>
      <td className="py-2"><div className="flex justify-center"><ScoreBadge score={req.score} size="sm" /></div></td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          {isOpen(req)
            ? <Tag tone={req.level >= 3 ? "danger" : "warn"}>{req.state === "searching" ? "순회 중" : "처리 전"}</Tag>
            : <Tag tone={RESULT_TONE[req.state]} solid={req.state === "found"}>{DONE_LABEL[req.state]}</Tag>}
          {req.note && <span className="max-w-48 truncate text-fs13 text-fg-3" title={req.note}>{req.note}</span>}
        </div>
      </td>
      <td className="py-2 pr-4">
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>근거</Button>
          <Button size="sm" variant="secondary" onClick={onSignal}>신호 기록</Button>
        </div>
        <EvidenceSheet req={req} open={open} onOpenChange={setOpen} />
      </td>
    </tr>
  )
}

/** 감독관 의견 · 사후 검증 기록으로 보관 */
function Notes({ sessionId }: { sessionId: number | null }) {
  const qc = useQueryClient()
  const [text, setText] = useState("")
  const notes = useQuery({ queryKey: ["notes", sessionId], queryFn: api.notes, enabled: sessionId != null })
  const add = useMutation({
    mutationFn: api.addNote,
    onSuccess: () => {
      setText("")
      void qc.invalidateQueries({ queryKey: ["notes", sessionId] })
    },
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    if (text.trim()) add.mutate(text.trim())
  }
  const list = notes.data ?? []
  return (
    <Panel title={<>감독관 의견 <span className="num font-medium text-fg-3">{list.length}</span></>} className="flex flex-col self-start">
      {list.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-fg-3">작성한 의견이 없습니다.</p>
      ) : (
        <ol className="max-h-80 divide-y divide-line overflow-y-auto">
          {list.map((n) => (
            <li key={n.id} className="grid grid-cols-[3.25rem_1fr] gap-2 px-4 py-2.5 text-sm">
              <span className="num pt-px text-fs13 text-fg-3">{n.sim_time < 0 ? "시작 전" : n.clock.slice(0, 5)}</span>
              <span className="leading-snug break-words whitespace-pre-wrap">{n.text}</span>
            </li>
          ))}
        </ol>
      )}
      <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
        <label htmlFor="note-text" className="sr-only">의견</label>
        <input id="note-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="의견을 적으세요 (예: 27번 가방 확인 · 이상 없음)"
          className="h-11 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 text-fs15 placeholder:text-fg-3 focus:border-brand focus:outline-none" />
        <Button type="submit" disabled={!text.trim() || add.isPending || sessionId == null}>등록</Button>
      </form>
      {add.isError && <p role="alert" className="px-4 pb-3 text-sm text-danger">{add.error.message}</p>}
    </Panel>
  )
}

function Big({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-5 py-4">
      <div className="text-fs13 font-semibold text-fg-3">{label}</div>
      <div className="num mt-1 text-fs36 leading-none font-bold">{value}</div>
    </div>
  )
}

function Track({ label, events, total, cls, sel, onPick }: { label: string; events: AgentEvent[]; total: number; cls: string; sel: number | null; onPick: (id: number) => void }) {
  return (
    <>
      <span className="text-fs13 text-fg-2">{label} <span className="num text-fg-3">{events.length}</span></span>
      <div className="relative h-6 rounded-sm bg-subtle">
        {events.map((e) => (
          <button key={e.id} type="button" onClick={() => onPick(e.id)} title={`${e.clock} ${e.message}`}
            className={cn("absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] hover:scale-y-125", cls, sel === e.id && "ring-2 ring-brand ring-offset-1")}
            style={{ left: `${(e.sim_time / 60 / total) * 100}%` }} />
        ))}
      </div>
    </>
  )
}
