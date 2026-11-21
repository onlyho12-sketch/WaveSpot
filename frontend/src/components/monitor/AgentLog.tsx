// 에이전트 판단 기록 (최신이 위) · 시각 | 상태 모양 | 단계 | 내용
import type { AgentEvent } from "@/lib/api"
import { Shape } from "@/components/ui/status"
import { cn, modelName, type Tone } from "@/lib/utils"

const TONE: Record<AgentEvent["level"], Tone> = { info: "neutral", caution: "warn", alert: "danger", done: "ok" }

// showCalls: 이 판단에서 부른 모델(진하게)과 건너뛴 모델(취소선) · 파이프라인이 아님을 보여줌 (v10)
export function AgentLog({ events, limit, showCalls = false, dense = false, selected, onSelect }: {
  events: AgentEvent[]
  limit?: number
  showCalls?: boolean
  dense?: boolean // 좁은 칸: 단계 이름을 내용 앞에 붙임
  selected?: number | null
  onSelect?: (id: number) => void
}) {
  let list = [...events].reverse()
  if (limit) list = list.slice(0, limit)
  if (!list.length) return <p className="px-4 py-8 text-center text-sm text-fg-3">판단 기록이 없습니다.</p>
  return (
    <ol className="divide-y divide-line">
      {list.map((e) => (
        <li key={e.id} id={`ev-${e.id}`}
          onClick={onSelect ? () => onSelect(e.id) : undefined}
          className={cn("grid items-start gap-x-2 px-4 py-2.5", dense ? "grid-cols-[3.25rem_12px_1fr]" : "grid-cols-[4.5rem_14px_3.25rem_1fr]", onSelect && "cursor-pointer hover:bg-subtle", selected === e.id && "bg-brand-soft")}>
          <span className="num pt-px text-[13px] text-fg-3">{e.sim_time < 0 ? "입실 전" : dense ? e.clock.slice(0, 5) : e.clock}</span>
          <span className="pt-1"><Shape tone={TONE[e.level]} className="size-2.5" /></span>
          {!dense && <span className="pt-px text-[13px] font-semibold text-fg-2">{e.stage}</span>}
          <span className="min-w-0 text-sm leading-snug">
            {dense && <span className="mr-1.5 text-[13px] font-semibold text-fg-2">{e.stage}</span>}
            <span className={cn(e.level === "alert" && "font-semibold text-danger")}>{e.message.replace(/\s*\([^)]*\)/g, "")}</span>
            {showCalls && e.data?.calls && e.data.calls.length > 0 && (
              <span className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
                {e.data.calls.map((c) => <span key={c} className="rounded-sm bg-fg-2 px-1.5 py-px font-semibold text-white">{modelName(c)}</span>)}
                {e.data.skipped?.map((c) => <span key={c} className="rounded-sm border border-line px-1.5 py-px text-fg-3 line-through">{modelName(c)}</span>)}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}
