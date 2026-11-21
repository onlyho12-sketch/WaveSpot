// 좌석 배치도 (참고: Framer '32 Seating Map' · Cisco Meraki 수신기 레이어)
// 감독관에게 필요한 것만: 기준점(교탁 · 출입문 · 감독관석), 표시된 구역 · 좌석, 고장 난 수신기
// 구역 이름 · 수신기 이름 · 범례는 화면에 나타난 것만 표시 · 표시된 구역은 ⋮ 메뉴
import { Check, Radio, ScanSearch, X } from "lucide-react"
import type { ReactNode } from "react"
import { Menu } from "@/components/ui/menu"
import { cn } from "@/lib/utils"

export type ZoneMark = { zone: number; kind: "request" | "candidate" | "watch"; label: string }
export type SeatState = "suspect" | "probe" | "found" | "cleared"

export function SeatMap({ rows, cols, zones = [], seats = {}, nodes = {}, compact = false, selected = null, onSelect, selectable, zoneMenu, legend: showLegend = true }: {
  rows: number
  cols: number
  zones?: ZoneMark[]
  seats?: Record<number, SeatState>
  nodes?: Record<string, boolean> // 수신기 정상 여부
  compact?: boolean
  selected?: number | null
  onSelect?: (seat: number) => void
  selectable?: number[] // 누를 수 있는 좌석 (결과 입력)
  zoneMenu?: (zone: number) => ReactNode | null // 구역 ⋮ 메뉴 항목 · null 이면 메뉴 없음
  legend?: boolean // 범례 표시 (순회 경로 설정처럼 구역 표시 뜻이 다를 때 끔)
}) {
  const half = Math.ceil(cols / 2)
  const mark = (z: number) => zones.find((m) => m.zone === z)
  const node = (id: string) => <Node id={id} ok={nodes[id] !== false} compact={compact} />
  const kinds = new Set(zones.map((z) => z.kind))
  const states = new Set(Object.values(seats))
  const legend: { icon: ReactNode; label: string }[] = []
  if (kinds.has("request")) legend.push({ icon: <ZoneChip cls="border-danger bg-danger-soft" />, label: "수색 구역" })
  if (kinds.has("candidate")) legend.push({ icon: <ZoneChip cls="border-warn-fill bg-warn-soft" />, label: "2순위 구역" })
  if (kinds.has("watch")) legend.push({ icon: <ZoneChip cls="border-warn-fill/60 bg-warn-soft/50" />, label: "관찰 중" })
  if (states.has("suspect")) legend.push({ icon: <SeatChip state="suspect" />, label: "확인할 좌석" })
  if (states.has("probe")) legend.push({ icon: <SeatChip state="probe" />, label: "지금 위치" })
  if (states.has("found")) legend.push({ icon: <SeatChip state="found" />, label: "기기 발견" })
  if (states.has("cleared")) legend.push({ icon: <SeatChip state="cleared" />, label: "미발견" })

  return (
    <div className="select-none">
      <div className={cn("grid items-stretch", compact ? "grid-cols-[22px_1fr_22px] gap-1.5" : "grid-cols-[44px_1fr_44px] gap-3")}>
        <div className="flex flex-col items-center justify-between py-1">
          {node("R1")}
          {!compact && <Landmark vertical>출입문</Landmark>}
          {node("R3")}
        </div>

        <div className="min-w-0">
          <div className={cn("flex justify-center", compact ? "mb-1.5" : "mb-3")}>
            <Landmark className={compact ? "h-6 w-1/2 text-[11px]" : "h-8 w-[46%]"}>교탁</Landmark>
          </div>
          <div className={cn("flex flex-col", compact ? "gap-0.5" : "gap-1.5")}>
            {Array.from({ length: rows }, (_, r) => (
              <div key={r} className={cn("grid grid-cols-2", compact ? "gap-2" : "gap-6")}>
                {[0, 1].map((h) => {
                  const zone = r * 2 + h + 1
                  const m = mark(zone)
                  const menu = zoneMenu?.(zone)
                  return (
                    <div key={h}
                      className={cn("relative rounded-md border-[1.5px]", compact ? "px-1 pt-4 pb-1" : "px-1.5 pt-6 pb-2",
                        !m && "border-transparent",
                        m?.kind === "request" && "border-dashed border-danger bg-danger-soft/60",
                        m?.kind === "candidate" && "border-dashed border-warn-fill bg-warn-soft/50",
                        m?.kind === "watch" && "border-dashed border-warn-fill/60 bg-warn-soft/30")}>
                      {menu && <Menu label={`${zone}구역 메뉴`} className="absolute -top-0.5 right-0">{menu}</Menu>}
                      {m && (
                        <span className={cn("num absolute left-1.5 max-w-[calc(100%-0.75rem)] truncate font-semibold whitespace-nowrap", compact ? "top-0.5 text-[10px]" : "top-1 text-xs", m.kind === "request" ? "text-danger" : "text-warn")}>
                          {m.label}
                        </span>
                      )}
                      <div className={cn("grid grid-cols-5", compact ? "gap-1" : "gap-2")}>
                        {Array.from({ length: half }, (_, i) => {
                          const seat = r * cols + h * half + i + 1
                          return (
                            <Seat key={seat} seat={seat} state={seats[seat]} compact={compact} selected={selected === seat}
                              onClick={onSelect && (!selectable || selectable.includes(seat)) ? () => onSelect(seat) : undefined} />
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          {!compact && (
            <div className="mt-2 flex justify-end pr-[12%]">
              <Landmark className="h-8 w-28">감독관석</Landmark>
            </div>
          )}
        </div>

        <div className="flex flex-col items-center justify-between py-1">
          {node("R2")}
          {node("R4")}
        </div>
      </div>

      {showLegend && legend.length > 0 && (
        <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-fg-2", compact ? "mt-2 text-xs" : "mt-4 border-t border-line pt-3 text-[13px]")}>
          {legend.map((l) => <li key={l.label} className="flex items-center gap-1.5">{l.icon}{l.label}</li>)}
        </ul>
      )}
    </div>
  )
}

function Seat({ seat, state, compact, selected, onClick }: { seat: number; state?: SeatState; compact: boolean; selected: boolean; onClick?: () => void }) {
  const Comp = onClick ? "button" : "div"
  return (
    <Comp type={onClick ? "button" : undefined} onClick={onClick} aria-pressed={onClick ? selected : undefined}
      aria-label={`${seat}번 좌석`}
      className={cn(
        "relative grid aspect-square w-full place-items-center justify-self-center rounded-md border num font-semibold transition-colors",
        compact ? "max-w-10 rounded text-[11px]" : "max-w-[58px] text-sm",
        !state && "border-line-strong bg-surface text-fg-2",
        state === "suspect" && "animate-pop border-danger bg-danger text-white",
        state === "probe" && "border-brand bg-brand-soft text-brand ring-2 ring-brand ring-offset-1",
        state === "found" && "animate-pop border-fg bg-fg text-surface",
        state === "cleared" && "border-line bg-subtle text-fg-3",
        onClick && "cursor-pointer hover:border-fg",
        selected && "ring-2 ring-fg ring-offset-2",
      )}>
      {seat}
      {!compact && state && state !== "probe" && (
        <span className={cn("absolute -top-1.5 -right-1.5 grid size-[18px] place-items-center rounded-full border-2 border-surface",
          state === "suspect" && "bg-danger text-white", state === "found" && "bg-fg text-surface", state === "cleared" && "bg-fg-3 text-surface")}>
          {state === "suspect" ? <ScanSearch className="size-2.5" strokeWidth={3} /> : state === "found" ? <Check className="size-2.5" strokeWidth={3.5} /> : <X className="size-2.5" strokeWidth={3.5} />}
        </span>
      )}
    </Comp>
  )
}

function SeatChip({ state }: { state: SeatState }) {
  return (
    <span className={cn("grid size-4 place-items-center rounded-sm border text-white",
      state === "suspect" && "border-danger bg-danger", state === "probe" && "border-brand bg-brand-soft ring-1 ring-brand",
      state === "found" && "border-fg bg-fg text-surface", state === "cleared" && "border-line bg-subtle text-fg-3")}>
      {state === "found" ? <Check className="size-3" strokeWidth={3} /> : state === "cleared" ? <X className="size-3" strokeWidth={3} /> : null}
    </span>
  )
}

const ZoneChip = ({ cls }: { cls: string }) => <span className={cn("h-3.5 w-5 rounded-sm border-[1.5px] border-dashed", cls)} />

/** 천장 수신기: 정상이면 작은 아이콘만, 고장이면 빨간 점선 + 이름 */
function Node({ id, ok, compact }: { id: string; ok: boolean; compact: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5" title={`천장 수신기 ${id} ${ok ? "정상" : "응답 없음"}`}>
      <span className={cn("grid place-items-center rounded", compact ? "size-[18px]" : "size-6",
        ok ? "bg-fg-3 text-surface" : "border-[1.5px] border-dashed border-danger bg-danger-soft text-danger")}>
        {ok ? <Radio className={compact ? "size-2.5" : "size-3.5"} /> : <X className={compact ? "size-2.5" : "size-3.5"} strokeWidth={3} />}
      </span>
      {!ok && <span className={cn("num font-bold text-danger", compact ? "text-[10px]" : "text-xs")}>{id} 꺼짐</span>}
    </div>
  )
}

function Landmark({ children, vertical, className }: { children: ReactNode; vertical?: boolean; className?: string }) {
  return (
    <div className={cn("grid place-items-center rounded-md border border-dashed border-line-strong bg-subtle text-xs font-semibold tracking-wide text-fg-3",
      vertical ? "h-28 w-8 [writing-mode:vertical-rl]" : "", className)}>
      {children}
    </div>
  )
}
