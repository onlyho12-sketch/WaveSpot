// 관리 화면 개요 그래프 (손으로 그린 SVG · HTML, 차트 라이브러리 없음)
// - 선 2px · 막대 24px 이하 · 데이터 끝만 4px 둥글게 · 격자는 1px 실선 · 글자는 글자색 토큰 (데이터 색을 글자에 쓰지 않음)
// - 상태 색(주의 · 경고)은 상태에만 쓰고 모양 + 글자와 함께
import { Activity, BrainCircuit, Gauge, Link2, MapPin, Smartphone, Wifi } from "lucide-react"
import type { ReactNode } from "react"
import type { AgentEvent } from "@/lib/api"
import { Shape } from "@/components/ui/status"
import { clockOf, cn, modelName, type Tone } from "@/lib/utils"

/** 축 최댓값을 1 · 2 · 2.5 · 5 × 10ⁿ 으로 올림 */
export function niceMax(v: number) {
  if (v <= 0) return 1
  const e = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= v) return m * e
  return 10 * e
}
/** AI 모델 6개 · 각 모델이 답하는 질문 (agent.py ROOM_MODEL + MODELS 순서) · 위치 추정은 교실 안/밖 → 구역 두 단계 */
const MODEL_INFO: Record<string, { name: string; q: string; algo: string; icon: ReactNode }> = {
  이상: { name: "이상 감지", q: "교실 전체 신호가 평소와 다른가", algo: "Isolation Forest", icon: <Activity /> },
  묶기: { name: "기기 묶기", q: "주소가 바뀌어도 같은 기기인가", algo: "로지스틱 회귀", icon: <Link2 /> },
  "안/밖": { name: "위치 추정", q: "① 교실 안인가 → ② 어느 구역인가", algo: "랜덤 포레스트 2단계", icon: <MapPin /> },
  종류: { name: "기기 종류", q: "어떤 종류의 기기인가", algo: "랜덤 포레스트", icon: <Smartphone /> },
  용도: { name: "Wi-Fi 용도", q: "영상 통화나 사진 전송 중인가", algo: "랜덤 포레스트", icon: <Wifi /> },
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
      {models.filter((k) => k !== "위치").map((k) => {
        // 위치 추정은 한 모델 (① 교실 안/밖 → ② 구역): 카드 하나에 두 단계 횟수를 함께
        const two = k === "안/밖"
        const zone = byModel["위치"] ?? 0
        const info = MODEL_INFO[k] ?? { name: modelName(k), q: "", algo: "", icon: <BrainCircuit /> }
        const total = totals[k] ?? total0
        const n = byModel[k] ?? 0
        const always = total > 0 && n >= total
        const skipped = Math.max(0, total - n)
        const share = total ? Math.min(1, n / total) : 0
        return (
          <li key={k} className="rounded-md border border-line px-3 py-2.5" title={`${info.name} 모델${info.algo ? ` (${info.algo})` : ""}: 부름 ${n.toLocaleString()}회, 건너뜀 ${skipped.toLocaleString()}회 (기기별 판단 ${total.toLocaleString()}회 기준)`}>
            <div className="flex items-start gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-brand-soft text-brand [&_svg]:size-4">{info.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-fs13 font-semibold">{info.name}</span>
                  <span className="num ml-auto shrink-0 text-fs15 font-bold">{n.toLocaleString()}<span className="text-xs font-semibold text-fg-3">회</span></span>
                </div>
                <div className="truncate text-xs text-fg-3">{info.q}</div>
              </div>
            </div>
            <span className="mt-2 flex h-2 gap-[2px] overflow-hidden rounded-full bg-subtle">
              {n > 0 && <span className="h-full bg-brand" style={{ width: `${share * 100}%` }} />}
              {skipped > 0 && <span className="h-full flex-1 bg-line-strong/50" />}
            </span>
            <div className="num mt-1 flex text-fs11 text-fg-3">
              <span className="font-semibold text-fg-2">{always ? "매번 부름" : `부름 ${Math.round(share * 100)}%`}</span>
              <span className="ml-auto">{always ? (k === "이상" ? "10초마다 교실 전체" : "주소가 바뀌면 한 번 더") : two ? `② 구역까지 ${zone.toLocaleString()}회` : `건너뜀 ${skipped.toLocaleString()}회`}</span>
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
    <div className="flex h-full flex-col">
      <div className="grid min-h-[100px] flex-1 grid-cols-[2rem_minmax(0,1fr)] gap-2">
        <div className="relative h-full">
          {ticks.map((t) => (
            <span key={t} className="num absolute right-0 -translate-y-1/2 text-fs13 text-fg-3" style={{ top: `${100 - (t / max) * 100}%` }}>{t}</span>
          ))}
        </div>
        <div className="relative h-full">
          {ticks.map((t) => <span key={t} className="absolute inset-x-0 h-px bg-line" style={{ top: `${100 - (t / max) * 100}%` }} />)}
          <div className="absolute inset-0 flex items-end justify-around">
            {cols.map((c, i) => {
              const segs = EV.filter((s) => c[s.key] > 0)
              const total = c.alert + c.caution + c.info
              return (
                <div key={i} className="flex h-full w-full max-w-6 flex-col-reverse gap-[2px]"
                  title={`${clockOf(i * bucket * 60, start)}~${clockOf((i + 1) * bucket * 60, start)}: 경보 ${c.alert}, 주의 ${c.caution}, 일반 ${c.info}`}>
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
      <div className="mt-1 ml-[2.5rem] flex justify-around">
        {cols.map((_, i) => (
          <span key={i} className="num w-full max-w-6 overflow-visible text-center text-fs13 whitespace-nowrap text-fg-3">
            {i % 2 === 0 ? clockOf(i * bucket * 60, start) : ""}
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-fs14 text-fg-2">
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
  const max = Math.max(1, ...now.map((r) => r.n))
  const bar: Record<Tone, string> = { warn: "bg-warn-fill", danger: "bg-danger", ok: "bg-ok", neutral: "bg-fg-2", off: "bg-danger", brand: "bg-brand" }
  const row = (key: string, head: ReactNode, n: number, tone: Tone) => (
    <li key={key} className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-3 text-fs16">
      {head}
      <span className="flex items-center gap-2">
        {n > 0 && <span className={cn("h-3.5 rounded-r-[4px]", bar[tone])} style={{ width: `${(n / max) * 85}%` }} />}
        <span className={cn("num font-bold", n === 0 && "font-medium text-fg-3")}>{n}</span>
      </span>
    </li>
  )
  return (
    <div className="flex h-full flex-col justify-between gap-2">
      <ul className="flex flex-1 flex-col justify-around gap-1">
        {now.map((r) => row(r.tag, <span className="flex items-center gap-1.5 truncate"><span className="num w-8 text-fs13 font-semibold text-fg-3">{r.tag}</span><span className="font-semibold text-fg-2">{r.label}</span></span>, r.n, r.tone))}
      </ul>
      {/* 수색 결과: 가로 한 줄 (칸 3개) */}
      <div className="border-t border-line pt-2">
        <div className="mb-1.5 text-fs13 font-semibold text-fg-3">수색 결과</div>
        <ul className="grid grid-cols-3 gap-2">
          {results.map((r) => (
            <li key={r.label} className="flex min-w-0 items-center gap-1.5 rounded-md bg-subtle px-2.5 py-1.5">
              <Shape tone={r.tone} className="size-2.5 shrink-0" />
              <span className="min-w-0 truncate text-fs13 font-semibold text-fg-2">{r.label}</span>
              <span className={cn("num ml-auto text-fs16 font-bold", r.n === 0 && "font-medium text-fg-3")}>{r.n}</span>
            </li>
          ))}
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
    <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-3 medium:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
      <span />
      <div className="relative h-5">
        {ticks.map((t) => (
          <span key={t} className={cn("num absolute text-fs11 text-fg-3", t === 0 ? "" : t === duration ? "-translate-x-full" : "hidden -translate-x-1/2 medium:inline")} style={{ left: x(t * 60) }}>
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
