// 관리 화면 상태 카드 · 얇은 나눔 막대 · 시간 표시 (개요 · 장애 · 공격 탭이 함께 씀)
import { ChevronRight } from "lucide-react"
import type { ReactNode } from "react"
import { Shape } from "@/components/ui/status"
import { cn, type Tone } from "@/lib/utils"

// 정상(ok)은 기본 글자색 · 색은 주의 · 위험에만
const VALUE_TONE: Partial<Record<Tone, string>> = { ok: "text-ok", warn: "text-warn", danger: "text-danger", off: "text-danger" }

/** 초 → "2분 10초" */
export const dur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}분${s % 60 >= 1 ? ` ${Math.round(s % 60)}초` : ""}` : `${Math.round(s)}초`)

/** 카드 큰 숫자용: 1분 이상이면 '분', 아니면 '초' (값이 없으면 -) */
export const durParts = (s: number | null) =>
  s == null ? { value: "-" } : s >= 60 ? { value: String(Math.floor(s / 60)), unit: `분${s % 60 >= 1 ? ` ${Math.round(s % 60)}초` : ""}` } : { value: String(Math.round(s)), unit: "초" }

/** '장애 및 복구' 카드의 지금 상태 · 훈련으로 넣은 장애(health.active)뿐 아니라
 *  시나리오 · 실제로 생긴 장애(끝나지 않은 기록)도 '진행 중'으로 봄 → 1건인데 '장애 없음'이 뜨지 않게 */
export function faultSummary(active: { title: string }[] | undefined, recs: { title: string; ended: number | null; recover_sec: number | null; started: number }[]) {
  const ongoing = active?.[0]?.title ?? recs.find((f) => f.ended == null)?.title ?? null
  const done = recs.filter((f) => f.ended != null)
  const avg = done.length ? done.reduce((a, f) => a + (f.recover_sec ?? f.ended! - f.started), 0) / done.length : null
  return {
    tone: (ongoing ? "warn" : recs.length ? "neutral" : "ok") as Tone,
    sub: ongoing ? `지금 ${ongoing}` : avg != null ? `${done.length}건 복구, 평균 ${dur(avg)}` : "장애 없음",
  }
}

/** 상태 카드: 이름 · 큰 숫자 · 한 줄 · 작은 막대 · onOpen 이 있으면 눌러서 해당 탭으로 */
export function Tile({ label, tone, value, unit, sub, small, children, onOpen }: {
  label: string; tone: Tone; value: string; unit?: string; sub: string; small?: boolean; children?: ReactNode; onOpen?: () => void
}) {
  const body = (
    <>
      <span className="flex w-full items-center gap-1.5 text-fs15 font-semibold text-fg-2">
        <Shape tone={tone} className="size-2.5" />
        {label}
        {onOpen && <ChevronRight className="ml-auto size-4 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100" />}
      </span>
      <span className="mt-2 flex items-baseline gap-0.5">
        <span className={cn("num leading-none font-bold", small ? "text-fs22" : "text-fs26", VALUE_TONE[tone] ?? "text-fg")}>{value}</span>
        {unit && <span className="text-fs15 font-semibold text-fg-2">{unit}</span>}
      </span>
      <span className="num mt-1.5 truncate text-fs14 text-fg-3">{sub}</span>
      {children && <span className="mt-auto block pt-3">{children}</span>}
    </>
  )
  const cls = "group flex min-w-0 flex-col rounded-lg border border-line bg-surface px-4 pt-3 pb-3.5 text-left"
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cn(cls, "transition-colors hover:border-line-strong")}>{body}</button>
  ) : (
    <div className={cls}>{body}</div>
  )
}

/** 얇은 나눔 막대 (조각 사이 2px 틈) · 전체가 0이면 그리지 않음 (빈 막대는 장식일 뿐) */
export function Meter({ parts, total, className }: { parts: { v: number; cls: string; label?: string }[]; total: number; className?: string }) {
  if (total <= 0) return null
  const shown = parts.filter((p) => p.v > 0)
  return (
    <span className={cn("flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-subtle", className)}>
      {total > 0 && shown.map((p, i) => <span key={i} title={p.label ? `${p.label} ${p.v}` : undefined} className={cn("h-full", p.cls)} style={{ width: `${(p.v / total) * 100}%` }} />)}
    </span>
  )
}
