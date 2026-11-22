// 교시 상태 타임라인 (Grafana State timeline)
// 1칸 = 1분, 같은 상태가 이어지면 한 띠로 합침 · 정상 / 주의(관찰 · 접근) / 수색 요청, 지금 위치는 세로선
import type { AgentEvent, Clock, SearchRequest } from "@/lib/api"
import { clockOf, cn, isOpen } from "@/lib/utils"

type S = "ok" | "warn" | "danger" | null
const RANK = { ok: 0, warn: 1, danger: 2 } as const

/** 기기마다 관찰 시작 ~ 마지막 기록은 주의, 수색 요청 ~ 결과(또는 지금)는 수색 요청 */
export function minuteStates(total: number, now: number, events: AgentEvent[], requests: SearchRequest[]): S[] {
  const s: S[] = Array.from({ length: total }, (_, i) => (i <= now ? "ok" : null))
  const put = (a: number, b: number, v: "warn" | "danger") => {
    for (let i = Math.max(0, a); i <= Math.min(b, total - 1, now); i++) if (s[i] == null || RANK[v] > RANK[s[i]!]) s[i] = v
  }
  const byDev = new Map<string, AgentEvent[]>()
  for (const e of events) if (e.device_id && e.sim_time >= 0) byDev.set(e.device_id, [...(byDev.get(e.device_id) ?? []), e])
  const lastMin = (id: string) => Math.max(...(byDev.get(id) ?? []).map((e) => Math.floor(e.sim_time / 60)), 0)
  for (const [id, list] of byDev) {
    const c = list.filter((e) => e.level === "caution" || e.level === "alert")
    if (c.length) put(Math.min(...c.map((e) => Math.floor(e.sim_time / 60))), lastMin(id), "warn")
  }
  for (const r of requests) put(Math.floor(r.sim_time / 60), isOpen(r) ? now : lastMin(r.device_id), "danger")
  return s
}

// 정상 구간은 회색 (색은 관찰 · 수색 요청에만)
const FILL: Record<string, string> = { ok: "bg-fg-3/45", warn: "bg-warn-fill", danger: "bg-danger" }
const NAME: Record<string, string> = { ok: "정상", warn: "관찰", danger: "수색 요청" }

export function StateBand({ states, total, now, height = "h-7", showNow = true }: { states: S[]; total: number; now: number; height?: string; showNow?: boolean }) {
  const segs: { from: number; to: number; v: S }[] = []
  states.forEach((v, i) => {
    const last = segs.at(-1)
    if (last && last.v === v) last.to = i + 1
    else segs.push({ from: i, to: i + 1, v })
  })
  return (
    <div className={cn("relative overflow-hidden rounded-sm bg-subtle", height)}>
      {segs.filter((g) => g.v).map((g) => (
        <div key={g.from} className={cn("absolute inset-y-0 flex items-center overflow-hidden border-r border-surface/70 px-1.5 text-fs11 font-semibold whitespace-nowrap text-white", FILL[g.v!])}
          style={{ left: `${(g.from / total) * 100}%`, width: `${((g.to - g.from) / total) * 100}%` }}
          title={`${NAME[g.v!]} ${g.to - g.from}분`}>
          {g.v !== "ok" && (g.to - g.from) / total > 0.06 ? NAME[g.v!] : ""}
        </div>
      ))}
      {showNow && now < total && <div className="absolute inset-y-0 w-0.5 bg-fg" style={{ left: `${((now + 1) / total) * 100}%` }} />}
    </div>
  )
}

export function Axis({ total, start }: { total: number; start: string }) {
  const ticks = Array.from({ length: Math.floor(total / 20) + 1 }, (_, i) => i * 20)
  return (
    <div className="relative mt-1 h-4 text-fs11 text-fg-3">
      {ticks.map((m) => (
        <span key={m} className={cn("num absolute -translate-x-1/2", m === 0 && "translate-x-0", m === total && "-translate-x-full")} style={{ left: `${(m / total) * 100}%` }}>
          {clockOf(m * 60, start)}
        </span>
      ))}
    </div>
  )
}

export function StateTimeline({ clock, events, requests, startLabel }: { clock: Clock | null; events: AgentEvent[]; requests: SearchRequest[]; startLabel: string }) {
  const total = clock?.duration_min ?? 100
  const now = clock && clock.state !== "setup" && clock.state !== "baseline" ? Math.min(total - 1, Math.floor(Math.max(clock.t, 0) / 60)) : -1
  const states = minuteStates(total, now, events, requests)
  return (
    <div>
      <div className="grid grid-cols-[64px_1fr] items-center gap-3">
        <span className="text-fs13 font-semibold text-fg-2">시험 진행</span>
        <StateBand states={states} total={total} now={now} />
      </div>
      <div className="grid grid-cols-[64px_1fr] gap-3">
        <span />
        <Axis total={total} start={startLabel} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-[76px] text-xs text-fg-2">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-fg-3/45" />정상</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-warn-fill" />관찰</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-danger" />수색 요청</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-fg" />지금</span>
      </div>
    </div>
  )
}
