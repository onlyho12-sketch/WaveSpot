// 좌석 배치도 (참고: Framer '32 Seating Map' · Cisco Meraki 수신기 레이어)
// 감독관에게 필요한 것만: 기준점(교탁 · 출입문 · 감독관석), 표시된 범위 · 좌석, 고장 난 수신기
// - 좌석은 시험장 책상처럼 모두 떨어져 있음 (앞뒤 간격이 옆 간격보다 조금 넓음 · 실제 교실 비율)
// - 의심 범위는 줄 단위 네모가 아니라 원: 전파는 기기에서 둥글게 퍼지므로 추정 위치를 중심으로 한 원형 범위(ROI)
//   가운데가 진하고 바깥으로 갈수록 옅음 = 가운데일수록 가능성이 높음. 수신기가 빠지면 원을 한 단계 넓힘
// 범위 이름 · 수신기 이름 · 범례는 화면에 나타난 것만 표시 · 표시된 범위는 ⋮ 메뉴
import { Check, Radio, ScanSearch, X } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"
import { Menu } from "@/components/ui/menu"
import { cn } from "@/lib/utils"

/** wide: 수신기 1대가 끊겨 위치가 덜 정확할 때 범위를 넓게 그림 */
export type ZoneMark = { zone: number; kind: "request" | "candidate" | "watch"; label: string; wide?: boolean }
export type SeatState = "suspect" | "probe" | "found" | "cleared"

const ROW_RATIO = 1.3 // 앞뒤 간격 / 옆 간격
const SEAT = 0.68 // 칸 너비 대비 좌석 크기 (나머지가 간격)
const ROI = 2.8 // 원 지름 (좌석 칸 수) · 넓힘은 1.35배

const TONE: Record<ZoneMark["kind"], { color: string; ring: string; text: string; core: number }> = {
  request: { color: "var(--color-danger)", ring: "border-danger", text: "text-danger", core: 62 },
  candidate: { color: "var(--color-warn-fill)", ring: "border-warn-fill", text: "text-warn", core: 42 },
  watch: { color: "var(--color-warn-fill)", ring: "border-warn-fill/60", text: "text-warn", core: 28 },
}

const fill = (k: ZoneMark["kind"]): CSSProperties => {
  const { color, core } = TONE[k]
  return {
    background: `radial-gradient(circle closest-side, color-mix(in srgb, ${color} ${core}%, transparent) 0%, color-mix(in srgb, ${color} ${Math.round(core * 0.45)}%, transparent) 55%, color-mix(in srgb, ${color} 6%, transparent) 100%)`,
  }
}

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
  zoneMenu?: (zone: number) => ReactNode | null // 범위 ⋮ 메뉴 항목 · null 이면 메뉴 없음
  legend?: boolean // 범례 표시 (순회 경로 설정처럼 범위 표시 뜻이 다를 때 끔)
}) {
  const half = Math.ceil(cols / 2)
  const node = (id: string) => <Node id={id} ok={nodes[id] !== false} compact={compact} />
  // 같은 구역에 표시가 여러 개면 가장 중요한 것 하나만 (수색 > 2순위 > 관찰)
  const RANK = { request: 0, candidate: 1, watch: 2 } as const
  const marks = [...zones].sort((a, b) => RANK[a.kind] - RANK[b.kind]).filter((m, i, a) => a.findIndex((x) => x.zone === m.zone) === i)
  const kinds = new Set(marks.map((z) => z.kind))
  const states = new Set(Object.values(seats))
  const legend: { icon: ReactNode; label: string }[] = []
  if (kinds.has("request")) legend.push({ icon: <RoiChip kind="request" />, label: "수색 범위" })
  if (kinds.has("candidate")) legend.push({ icon: <RoiChip kind="candidate" />, label: "2순위 범위" })
  if (kinds.has("watch")) legend.push({ icon: <RoiChip kind="watch" />, label: "관찰 중" })
  if (marks.some((m) => m.wide)) legend.push({ icon: <span className="text-fs11 font-bold text-fg-3">◌</span>, label: "수신기 부족으로 넓게 표시" })
  if (states.has("suspect")) legend.push({ icon: <SeatChip state="suspect" />, label: "확인할 좌석" })
  if (states.has("probe")) legend.push({ icon: <SeatChip state="probe" />, label: "지금 위치" })
  if (states.has("found")) legend.push({ icon: <SeatChip state="found" />, label: "기기 발견" })
  if (states.has("cleared")) legend.push({ icon: <SeatChip state="cleared" />, label: "미발견" })

  /** 구역(반쪽 줄 5석)의 가운데 = 원의 중심 (배치도 너비 · 높이 대비 %) */
  const center = (z: number) => {
    const r = Math.floor((z - 1) / 2)
    const h = (z - 1) % 2
    return { x: ((h * half + half / 2) / cols) * 100, y: ((r + 0.5) / rows) * 100 }
  }
  const roiBox = (m: ZoneMark): CSSProperties => {
    const { x, y } = center(m.zone)
    const d = ((ROI * (m.wide ? 1.35 : 1)) / cols) * 100
    return { left: `${x}%`, top: `${y}%`, width: `${d}%` }
  }

  return (
    <div className="select-none">
      <div className={cn("grid items-stretch", compact ? "grid-cols-[22px_1fr_22px] gap-1.5" : "grid-cols-[44px_1fr_44px] gap-3")}>
        <div className="flex flex-col items-center justify-between py-1">
          {node("R1")}
          {!compact && <Landmark vertical>출입문</Landmark>}
          {node("R3")}
        </div>

        <div className="min-w-0">
          {/* 앞쪽: 교탁 + 감독관석 (감독관은 교탁 옆 · 입실 전 기준선에서 감독관 폰이 교탁 자리로 등록됨) */}
          <div className={cn("relative mx-auto flex items-center justify-center", compact ? "mb-1.5" : "mb-3 max-w-[680px]")}>
            <Landmark className={compact ? "h-6 w-1/2 text-fs11" : "h-8 w-[46%]"}>{compact ? "교탁과 감독관" : "교탁"}</Landmark>
            {!compact && <Landmark className="absolute right-[6%] h-8 w-[18%]">감독관석</Landmark>}
          </div>

          <div className={cn("relative mx-auto", !compact && "max-w-[680px]")}>
            {/* 1층: 원형 범위 (좌석 아래) · 중요한 범위가 위에 오도록 관찰 → 2순위 → 수색 순서로 그림
                원은 좌석 영역 안에서만 보이게 자름 (넓은 원이 카운터 · 교탁 위로 번지지 않게) */}
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ clipPath: `inset(-${compact ? 8 : 16}px round ${compact ? 10 : 18}px)` }}>
              {/* 움직임: 처음 나타날 때 커지며 등장 · 수신기가 빠져 넓힐 때 0.6초에 걸쳐 넓어짐 */}
              {[...marks].reverse().map((m) => (
                <div key={`f${m.zone}`} className="absolute aspect-square -translate-x-1/2 -translate-y-1/2 animate-roi-in transition-[width] duration-600 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
                  style={roiBox(m)}>
                  {/* 단계가 바뀌면(관찰 → 수색) 다시 그려서 한 번 커졌다 돌아옴 */}
                  <div key={m.kind} className={cn("absolute inset-0 rounded-full border-[1.5px] border-dashed", TONE[m.kind].ring, m.kind === "request" && "animate-roi-bump")}
                    style={fill(m.kind)}>
                    {/* 퍼지는 전파 느낌의 안쪽 고리 */}
                    <span className={cn("absolute inset-[24%] rounded-full border border-dashed opacity-60", TONE[m.kind].ring)} />
                  </div>
                  {/* 수색 범위만: 기기에서 전파가 퍼지듯 바깥으로 고리 2개 (3번 퍼지고 멈춤) */}
                  {m.kind === "request" && (
                    <>
                      <span className="absolute inset-0 rounded-full border-2 border-danger opacity-0 animate-ripple" />
                      <span className="absolute inset-0 rounded-full border-2 border-danger opacity-0 animate-ripple [animation-delay:1.2s]" />
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* 2층: 좌석 (모두 같은 간격) */}
            <div className="relative grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {Array.from({ length: rows * cols }, (_, i) => {
                const seat = i + 1
                return (
                  <div key={seat} className="grid place-items-center" style={{ aspectRatio: `1 / ${ROW_RATIO}` }}>
                    <Seat seat={seat} state={seats[seat]} compact={compact} selected={selected === seat}
                      onClick={onSelect && (!selectable || selectable.includes(seat)) ? () => onSelect(seat) : undefined} />
                  </div>
                )
              })}
            </div>

            {/* 3층: 범위 이름 · ⋮ 메뉴 — 좌석을 가리지 않도록 그 줄 바로 위 통로(줄 사이 빈칸)에 둠 */}
            {marks.map((m) => {
              const menu = zoneMenu?.(m.zone)
              const r = Math.floor((m.zone - 1) / 2)
              return (
                <div key={`l${m.zone}`} className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 animate-label-in items-center gap-0.5"
                  style={{ left: `${center(m.zone).x}%`, top: `${(r / rows) * 100}%` }}>
                  <span className={cn("num max-w-40 truncate rounded-full border bg-surface px-2 font-semibold whitespace-nowrap",
                    compact ? "py-px text-fs10" : "py-0.5 text-xs", TONE[m.kind].text, TONE[m.kind].ring)}>
                    {m.label}
                  </span>
                  {menu && <Menu label={`${m.zone}구역 메뉴`} className="rounded-md bg-surface">{menu}</Menu>}
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col items-center justify-between py-1">
          {node("R2")}
          {node("R4")}
        </div>
      </div>

      {showLegend && legend.length > 0 && (
        <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-fg-2", compact ? "mt-2 text-xs" : "mt-4 border-t border-line pt-3 text-fs13")}>
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
      aria-label={`${seat}번 좌석`} style={{ width: `${SEAT * 100}%` }}
      className={cn(
        "relative grid aspect-square place-items-center border num font-semibold transition-colors",
        compact ? "rounded text-fs11" : "rounded-md text-sm",
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

const RoiChip = ({ kind }: { kind: ZoneMark["kind"] }) => (
  <span className={cn("size-4 rounded-full border-[1.5px] border-dashed", TONE[kind].ring)} style={fill(kind)} />
)

/** 천장 수신기: 정상이면 작은 아이콘만, 고장이면 빨간 점선 + 이름 */
function Node({ id, ok, compact }: { id: string; ok: boolean; compact: boolean }) {
  return (
    <div className="flex flex-col items-center gap-0.5" title={`천장 수신기 ${id} ${ok ? "정상" : "응답 없음"}`}>
      <span className={cn("grid place-items-center rounded", compact ? "size-[18px]" : "size-6",
        ok ? "bg-fg-3 text-surface" : "animate-blink border-[1.5px] border-dashed border-danger bg-danger-soft text-danger")}>
        {ok ? <Radio className={compact ? "size-2.5" : "size-3.5"} /> : <X className={compact ? "size-2.5" : "size-3.5"} strokeWidth={3} />}
      </span>
      {!ok && <span className={cn("num font-bold text-danger", compact ? "text-fs10" : "text-xs")}>{id} 꺼짐</span>}
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
