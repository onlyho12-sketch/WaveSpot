// 관리 화면 개요 그래프 (손으로 그린 SVG · HTML, 차트 라이브러리 없음)
// - 선 2px · 막대 24px 이하 · 데이터 끝만 4px 둥글게 · 격자는 1px 실선 · 글자는 글자색 토큰 (데이터 색을 글자에 쓰지 않음)
// - 상태 색(주의 · 경고)은 상태에만 쓰고 모양 + 글자와 함께
// - '모두 실행'(파이프라인) 선은 비교 기준이라 회색으로 낮춤 · 에이전트만 파란색 + 범례 + 끝 라벨
import { Activity, BrainCircuit, DoorOpen, Gauge, Link2, MapPin, Smartphone, Wifi } from "lucide-react"
import { type PointerEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react"
import type { AgentEvent } from "@/lib/api"
import { Shape } from "@/components/ui/status"
import { clockOf, cn, modelName, type Tone } from "@/lib/utils"

const PIPE = "#9aa8b8" // 비교 기준선 (회색)

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** 축 최댓값을 1 · 2 · 2.5 · 5 × 10ⁿ 으로 올림 */
export function niceMax(v: number) {
  if (v <= 0) return 1
  const e = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= v) return m * e
  return 10 * e
}
const tick = (v: number, compact: boolean) => (compact ? `${+(v / 1000).toFixed(1)}K` : Math.round(v).toLocaleString())

/** 모델 호출 누적 추이: 에이전트 vs 모두 실행 (분 단위) · 마우스를 올리면 그 시각 값 */
export function CallsTrend({ series, duration, start }: { series: [number, number, number][]; duration: number; start: string }) {
  const [ref, w] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const H = 232
  const m = { l: 44, r: 112, t: 12, b: 26 }
  const iw = Math.max(0, w - m.l - m.r)
  const ih = H - m.t - m.b
  const last = series.at(-1)
  const ymax = niceMax(last ? last[2] : 0)
  const compact = ymax >= 10000
  const x = (min: number) => m.l + (min / duration) * iw
  const y = (v: number) => m.t + ih - (v / ymax) * ih
  const line = (i: 1 | 2) => series.map((p, k) => `${k ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[i]).toFixed(1)}`).join("")
  const area = last ? `${line(1)}L${x(last[0]).toFixed(1)},${y(0)}L${x(series[0][0]).toFixed(1)},${y(0)}Z` : ""
  // 시각 눈금: 칸이 좁으면 간격을 넓혀 글자가 겹치지 않게 (20분 칸이 48px 미만이면 40분, 그래도 좁으면 50분)
  const stepMin = iw / duration * 20 >= 48 ? 20 : iw / duration * 40 >= 48 ? 40 : 50
  const xt = Array.from({ length: Math.floor(duration / stepMin) + 1 }, (_, i) => i * stepMin)
  const hp = hover != null ? series[hover] : null

  function move(e: PointerEvent<SVGRectElement>) {
    if (!series.length || iw <= 0) return
    const r = e.currentTarget.getBoundingClientRect()
    const min = ((e.clientX - r.left) / r.width) * duration
    let best = 0
    series.forEach((p, k) => Math.abs(p[0] - min) < Math.abs(series[best][0] - min) && (best = k))
    setHover(best)
  }

  // 끝 라벨이 겹치면 '모두 실행'을 위로 밀어 올림
  let ya = last ? y(last[1]) : 0
  let yp = last ? y(last[2]) : 0
  if (last && Math.abs(ya - yp) < 18) {
    yp = Math.min(yp, ya) - 9
    ya = yp + 18
  }

  return (
    <div ref={ref} className="relative">
      {!last ? (
        <p className="grid h-[232px] place-items-center text-sm text-fg-3">감시를 시작하면 그려집니다</p>
      ) : w > 0 && (
        <svg width={w} height={H} role="img" aria-label={`모델 호출 누적: 에이전트 ${last[1].toLocaleString()}회, 모두 실행하면 ${last[2].toLocaleString()}회`}>
          {[0, 1, 2, 3, 4].map((i) => {
            const v = (ymax * i) / 4
            return (
              <g key={i}>
                <line x1={m.l} x2={m.l + iw} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
                <text x={m.l - 8} y={y(v)} dy="0.32em" textAnchor="end" style={{ fontSize: "var(--fs-11)" }} fill="var(--color-fg-3)" className="num">{tick(v, compact)}</text>
              </g>
            )
          })}
          {xt.map((t) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor={t === 0 ? "start" : t === duration ? "end" : "middle"} style={{ fontSize: "var(--fs-11)" }} fill="var(--color-fg-3)" className="num">
              {clockOf(t * 60, start)}
            </text>
          ))}
          <path d={area} fill="var(--color-brand)" fillOpacity={0.1} />
          <path d={line(2)} fill="none" stroke={PIPE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={line(1)} fill="none" stroke="var(--color-brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {/* 끝 점 + 끝 라벨 (글자는 글자색, 색은 점이 담당) */}
          <circle cx={x(last[0])} cy={y(last[2])} r={4} fill={PIPE} stroke="var(--color-surface)" strokeWidth={2} />
          <circle cx={x(last[0])} cy={y(last[1])} r={4} fill="var(--color-brand)" stroke="var(--color-surface)" strokeWidth={2} />
          <text x={x(last[0]) + 10} y={yp} dy="0.32em" style={{ fontSize: "var(--fs-12)" }} fill="var(--color-fg-2)" className="num">모두 실행 <tspan fontWeight={700} fill="var(--color-fg)">{last[2].toLocaleString()}</tspan></text>
          <text x={x(last[0]) + 10} y={ya} dy="0.32em" style={{ fontSize: "var(--fs-12)" }} fill="var(--color-fg-2)" className="num">에이전트 <tspan fontWeight={700} fill="var(--color-fg)">{last[1].toLocaleString()}</tspan></text>
          {hp && (
            <g pointerEvents="none">
              <line x1={x(hp[0])} x2={x(hp[0])} y1={m.t} y2={m.t + ih} stroke="var(--color-fg-3)" strokeWidth={1} />
              <circle cx={x(hp[0])} cy={y(hp[2])} r={4} fill={PIPE} stroke="var(--color-surface)" strokeWidth={2} />
              <circle cx={x(hp[0])} cy={y(hp[1])} r={4} fill="var(--color-brand)" stroke="var(--color-surface)" strokeWidth={2} />
            </g>
          )}
          <rect x={m.l} y={m.t} width={iw} height={ih} fill="transparent" onPointerMove={move} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {hp && (
        <div className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-sm"
          style={{ left: Math.min(Math.max(x(hp[0]) + 12, 0), Math.max(0, w - 160)) }}>
          <div className="num mb-1 font-semibold">{clockOf(hp[0] * 60, start)}</div>
          <div className="num flex items-center gap-2"><span className="h-0.5 w-3 rounded bg-brand" />에이전트<b className="ml-auto">{hp[1].toLocaleString()}</b></div>
          <div className="num flex items-center gap-2"><span className="h-0.5 w-3 rounded" style={{ background: PIPE }} />모두 실행<b className="ml-auto">{hp[2].toLocaleString()}</b></div>
          {hp[2] > 0 && <div className="num mt-1 border-t border-line pt-1 text-fg-2">{Math.round((1 - hp[1] / hp[2]) * 100)}% 절약</div>}
        </div>
      )}
    </div>
  )
}

export function TrendLegend() {
  return (
    <span className="flex items-center gap-3 text-xs text-fg-2">
      <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-brand" />에이전트</span>
      <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: PIPE }} />모델 모두 실행</span>
    </span>
  )
}

/** AI 모델 6개 · 각 모델이 답하는 질문 (agent.py ROOM_MODEL + MODELS 순서) · 위치 추정은 교실 안/밖 → 구역 두 단계 */
const MODEL_INFO: Record<string, { name: string; q: string; algo: string; icon: ReactNode }> = {
  이상: { name: "이상 감지", q: "교실 전체 신호가 평소와 다른가", algo: "Isolation Forest", icon: <Activity /> },
  묶기: { name: "기기 묶기", q: "주소가 바뀌어도 같은 기기인가", algo: "로지스틱 회귀", icon: <Link2 /> },
  "안/밖": { name: "위치 추정 · 교실 안/밖", q: "교실 안에서 나는 신호인가", algo: "랜덤 포레스트", icon: <DoorOpen /> },
  위치: { name: "위치 추정 · 구역", q: "교실 어느 반쪽 줄(5석)에 있나", algo: "랜덤 포레스트", icon: <MapPin /> },
  종류: { name: "기기 종류", q: "이어폰 · 안경 · 휴대폰 · 시계 중 무엇인가", algo: "랜덤 포레스트", icon: <Smartphone /> },
  용도: { name: "Wi-Fi 용도", q: "영상 통화 · 사진 전송 중인가", algo: "랜덤 포레스트", icon: <Wifi /> },
  점수: { name: "위험 점수", q: "정밀 수색하면 기기가 나올 가능성", algo: "로지스틱 회귀", icon: <Gauge /> },
}

/**
 * AI 모델 6개 카드: 모델 이름 · 답하는 질문 · 부른 횟수 / 건너뛴 횟수
 * 기준(total) = 기기별 판단 횟수 · 모두 실행하는 방식이라면 모델마다 이만큼 돌림
 * 기기 연결은 주소가 바뀐 기기를 이을 때 한 판단에서 두 번 부르기도 해 기준을 넘을 수 있음 → '매번 부름'
 */
export function ModelCards({ models, byModel, total: total0, totals = {} }: { models: string[]; byModel: Record<string, number>; total: number; totals?: Record<string, number> }) {
  return (
    <ul className="grid grid-cols-1 gap-2.5 medium:grid-cols-2">
      {models.map((k) => {
        const info = MODEL_INFO[k] ?? { name: modelName(k), q: "", algo: "", icon: <BrainCircuit /> }
        const total = totals[k] ?? total0
        const n = byModel[k] ?? 0
        const always = total > 0 && n >= total
        const skipped = Math.max(0, total - n)
        const share = total ? Math.min(1, n / total) : 0
        return (
          <li key={k} className="rounded-md border border-line px-3 py-2.5" title={`${info.name} 모델 · 부름 ${n.toLocaleString()}회 · 건너뜀 ${skipped.toLocaleString()}회 (기기별 판단 ${total.toLocaleString()}회 기준)`}>
            <div className="flex items-start gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-brand-soft text-brand [&_svg]:size-4">{info.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-fs13 font-semibold">{info.name}</span>
                  <span className="num ml-auto shrink-0 text-fs15 font-bold">{n.toLocaleString()}<span className="text-xs font-semibold text-fg-3">회</span></span>
                </div>
                <div className="truncate text-xs text-fg-3">{info.q}{info.algo && ` · ${info.algo}`}</div>
              </div>
            </div>
            <span className="mt-2 flex h-2 gap-[2px] overflow-hidden rounded-full bg-subtle">
              {n > 0 && <span className="h-full bg-brand" style={{ width: `${share * 100}%` }} />}
              {skipped > 0 && <span className="h-full flex-1 bg-line-strong/50" />}
            </span>
            <div className="num mt-1 flex text-fs11 text-fg-3">
              <span className="font-semibold text-fg-2">{always ? "매번 부름" : `부름 ${Math.round(share * 100)}%`}</span>
              <span className="ml-auto">{always ? "주소가 바뀌면 한 번 더" : `건너뜀 ${skipped.toLocaleString()}회`}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const EV: { key: "alert" | "caution" | "info"; label: string; tone: Tone; cls: string }[] = [
  { key: "info", label: "일반", tone: "neutral", cls: "bg-fg-3/45" },
  { key: "caution", label: "주의", tone: "warn", cls: "bg-warn-fill" },
  { key: "alert", label: "경보", tone: "danger", cls: "bg-danger" },
]

/** 판단 기록 수 · 10분마다 (경보 · 주의 · 기록 쌓은 막대) */
export function EventColumns({ events, duration, start, bucket = 10 }: { events: AgentEvent[]; duration: number; start: string; bucket?: number }) {
  const n = Math.max(1, Math.ceil(duration / bucket))
  const cols = Array.from({ length: n }, () => ({ alert: 0, caution: 0, info: 0 }))
  for (const e of events) {
    if (e.sim_time < 0) continue
    const k = Math.min(n - 1, Math.floor(e.sim_time / 60 / bucket))
    cols[k][e.level === "alert" ? "alert" : e.level === "caution" ? "caution" : "info"]++
  }
  const max = niceMax(Math.max(...cols.map((c) => c.alert + c.caution + c.info), 4))
  const ticks = [0, max / 2, max]
  return (
    <div>
      <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2">
        <div className="relative h-[150px]">
          {ticks.map((t) => (
            <span key={t} className="num absolute right-0 -translate-y-1/2 text-fs11 text-fg-3" style={{ top: `${100 - (t / max) * 100}%` }}>{t}</span>
          ))}
        </div>
        <div className="relative h-[150px]">
          {ticks.map((t) => <span key={t} className="absolute inset-x-0 h-px bg-line" style={{ top: `${100 - (t / max) * 100}%` }} />)}
          <div className="absolute inset-0 flex items-end justify-around">
            {cols.map((c, i) => {
              const segs = EV.filter((s) => c[s.key] > 0)
              const total = c.alert + c.caution + c.info
              return (
                <div key={i} className="flex h-full w-full max-w-6 flex-col-reverse gap-[2px]"
                  title={`${clockOf(i * bucket * 60, start)}~${clockOf((i + 1) * bucket * 60, start)} · 경보 ${c.alert} · 주의 ${c.caution} · 일반 ${c.info}`}>
                  {segs.map((s, j) => (
                    <span key={s.key} className={cn("block shrink-0", s.cls, j === segs.length - 1 && "rounded-t-[4px]")}
                      style={{ height: `calc(${(c[s.key] / max) * 100}% - 2px)` }} />
                  ))}
                  {total === 0 && <span className="block h-px shrink-0 bg-line-strong" />}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="ml-[2.25rem] flex justify-around">
        {cols.map((_, i) => (
          <span key={i} className="num w-full max-w-6 overflow-visible text-center text-fs11 whitespace-nowrap text-fg-3">
            {i % 2 === 0 ? clockOf(i * bucket * 60, start) : ""}
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-xs text-fg-2">
        {[...EV].reverse().map((s) => <span key={s.key} className="flex items-center gap-1.5"><Shape tone={s.tone} className="size-2.5" />{s.label}</span>)}
      </div>
    </div>
  )
}

/** 수색 단계 · 결과별 수 (가로 막대 · 값은 막대 끝) */
export function LadderBars({ now, results }: {
  now: { tag: string; label: string; n: number; tone: Tone }[]
  results: { label: string; n: number; tone: Tone }[]
}) {
  const max = Math.max(1, ...now.map((r) => r.n), ...results.map((r) => r.n))
  const bar: Record<Tone, string> = { warn: "bg-warn-fill", danger: "bg-danger", ok: "bg-ok", neutral: "bg-fg-2", off: "bg-danger", brand: "bg-brand" }
  const row = (key: string, head: ReactNode, n: number, tone: Tone) => (
    <li key={key} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 text-fs13">
      {head}
      <span className="flex items-center gap-2">
        {n > 0 && <span className={cn("h-3 rounded-r-[4px]", bar[tone])} style={{ width: `${(n / max) * 85}%` }} />}
        <span className={cn("num font-bold", n === 0 && "font-medium text-fg-3")}>{n}</span>
      </span>
    </li>
  )
  return (
    <div className="space-y-4">
      <ul className="space-y-2.5">
        {now.map((r) => row(r.tag, <span className="flex items-center gap-1.5 truncate"><span className="num w-7 text-xs font-semibold text-fg-3">{r.tag}</span><span className="font-semibold text-fg-2">{r.label}</span></span>, r.n, r.tone))}
      </ul>
      <div className="border-t border-line pt-3">
        <div className="mb-2 text-xs font-semibold text-fg-3">수색 결과</div>
        <ul className="space-y-2.5">
          {results.map((r) => row(r.label, <span className="flex items-center gap-1.5 truncate font-semibold text-fg-2"><Shape tone={r.tone} className="size-2.5" />{r.label}</span>, r.n, r.tone))}
        </ul>
      </div>
    </div>
  )
}

export type SpanRow = {
  key: string
  label: string
  tag?: string // '재현' 등
  start: number // 경과 초
  end: number | null // null = 진행 중 (지금까지)
  mark?: number | null // 탐지 시각 (◆)
  tone: "warn" | "danger"
  tip: string
}

/** 교시 타임라인: 행마다 시작 ~ 끝 막대 (장애는 주황 · 공격은 빨강, 탐지 시각 ◆) · 지금 시각 세로선 */
export function SpanTimeline({ rows, duration, start, now }: { rows: SpanRow[]; duration: number; start: string; now: number }) {
  const total = duration * 60
  const x = (s: number) => `${Math.min(100, Math.max(0, (s / total) * 100))}%`
  const ticks = Array.from({ length: Math.floor(duration / 20) + 1 }, (_, i) => i * 20)
  const fill = { warn: "bg-warn-fill", danger: "bg-danger" }
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-3">
      <span />
      <div className="relative h-5">
        {ticks.map((t) => (
          <span key={t} className={cn("num absolute text-fs11 text-fg-3", t === 0 ? "" : t === duration ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: x(t * 60) }}>
            {clockOf(t * 60, start)}
          </span>
        ))}
      </div>
      {rows.map((r) => {
        const end = r.end ?? now
        return (
          <div key={r.key} className="contents">
            <div className="flex min-w-0 items-center gap-1.5 border-t border-line py-2 text-fs13">
              <span className="truncate font-semibold" title={r.label}>{r.label}</span>
              {r.tag && <span className="shrink-0 rounded bg-fg/[0.06] px-1 text-fs11 font-semibold text-fg-2">{r.tag}</span>}
            </div>
            <div className="relative border-t border-line" title={r.tip}>
              {ticks.map((t) => <span key={t} className="absolute inset-y-0 w-px bg-line/70" style={{ left: x(t * 60) }} />)}
              <span className="absolute inset-y-0 w-0.5 bg-brand/60" style={{ left: x(now) }} />
              <span className={cn("absolute top-1/2 h-3 min-w-1.5 -translate-y-1/2 rounded-[4px]", fill[r.tone], r.end == null && "rounded-r-none opacity-80")}
                style={{ left: x(r.start), width: `calc(${x(end)} - ${x(r.start)})` }} />
              {r.end == null && <span className={cn("absolute top-1/2 h-4 w-0.5 -translate-y-1/2", fill[r.tone])} style={{ left: x(end) }} />}
              {r.mark != null && (
                <svg viewBox="0 0 12 12" className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2" style={{ left: x(r.mark) }} aria-hidden>
                  <path d="M6 .6 11.4 6 6 11.4.6 6Z" fill="var(--color-fg)" stroke="var(--color-surface)" strokeWidth="1.5" />
                </svg>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
