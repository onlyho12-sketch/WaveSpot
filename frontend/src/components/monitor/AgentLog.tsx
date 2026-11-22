// 에이전트 판단 기록 (최신이 위) · 시각 | 상태 모양 | 단계 | 내용
import type { AgentEvent } from "@/lib/api"
import { Shape } from "@/components/ui/status"
import { cn, DEVICE_MODELS, MODEL_KEYS, ROOM_MODEL, type Tone } from "@/lib/utils"

const TONE: Record<AgentEvent["level"], Tone> = { info: "neutral", caution: "warn", alert: "danger", done: "ok" }

// showCalls: 이 판단에서 AI 모델 6개 중 몇 개를 불렀는지 (채운 칸 = 부름, 빈 칸 = 건너뜀) · 파이프라인이 아님을 보여줌 (v10)
export function AgentLog({ events, limit, showCalls = false, dense = false, big = false, selected, onSelect }: {
  events: AgentEvent[]
  limit?: number
  showCalls?: boolean
  dense?: boolean // 좁은 칸: 단계 이름을 내용 앞에 붙임
  big?: boolean // 관리 개요: 글씨를 키움
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
          className={cn("grid items-start gap-x-2 px-4", big ? "py-3" : "py-2.5", dense ? (big ? "grid-cols-[4rem_12px_1fr]" : "grid-cols-[3.5rem_12px_1fr]") : "grid-cols-[3.75rem_12px_1fr] medium:grid-cols-[5rem_14px_4.75rem_1fr]", onSelect && "cursor-pointer hover:bg-subtle", selected === e.id && "bg-brand-soft")}>
          <span className={cn("num pt-px whitespace-nowrap text-fg-3", big ? "text-fs15" : "text-fs13")}>{e.sim_time < 0 ? "입실 전" : dense ? e.clock.slice(0, 5) : e.clock}</span>
          <span className="pt-1"><Shape tone={TONE[e.level]} className="size-2.5" /></span>
          {!dense && <span className="hidden pt-px text-fs13 font-semibold whitespace-nowrap text-fg-2 medium:block">{e.stage}</span>}
          <span className={cn("min-w-0 leading-snug", big ? "truncate text-fs16" : "text-sm")}>
            <span className={cn("mr-1.5 font-semibold text-fg-2", big ? "text-fs15" : "text-fs13", !dense && "medium:hidden")}>{e.stage}</span>
            <span className={cn(e.level === "alert" && "font-semibold text-danger")}>{e.message.replace(/\s*\([^)]*\)/g, "")}</span>
            {showCalls && e.data?.calls && e.data.calls.length > 0 && <ModelUse calls={e.data.calls} className="mt-1" />}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** 기기마다 부르는 모델 5개 중 부른 것: '기기별 모델 2/5' + 칸 5개(채움 = 부름) + 부른 모델 이름 */
export function ModelUse({ calls, className }: { calls: string[]; className?: string }) {
  const used = new Set(calls)
  if (used.has(ROOM_MODEL) && !MODEL_KEYS.some((m) => used.has(m))) {
    // 교실 전체를 보는 이상 감지 모델 (기기별 단계가 아님)
    return <span className={cn("text-xs font-semibold text-fg-2", className)}>AI 이상 감지 모델 (교실 전체)</span>
  }
  const on = DEVICE_MODELS.filter((g) => g.keys.some((k) => used.has(k)))
  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs", className)}>
      <span className="num shrink-0 font-semibold text-fg-2">기기별 모델 {on.length}/{DEVICE_MODELS.length}</span>
      <span className="flex shrink-0 gap-0.5" aria-hidden>
        {DEVICE_MODELS.map((g) => (
          <span key={g.name} title={`${g.name} ${on.includes(g) ? "사용" : "건너뜀"}`}
            className={cn("size-2 rounded-[2px]", on.includes(g) ? "bg-fg-2" : "border border-line-strong")} />
        ))}
      </span>
      <span className="text-fg-3">{on.map((g) => g.name).join(", ")}</span>
    </span>
  )
}
