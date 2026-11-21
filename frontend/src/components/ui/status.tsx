// 상태 표시 · 모양 + 색 + 글자 (IBM Carbon status indicator)
// 색약 · 흑백 인쇄에서도 구분되도록 모양을 다르게: 정상 ● · 주의 ▲ · 경고 ◆ · 끊김 ○ · 대기 □
import type { ReactNode } from "react"
import { cn, type Tone } from "@/lib/utils"

export function Shape({ tone, className }: { tone: Tone; className?: string }) {
  const c = cn("size-3 shrink-0", className)
  switch (tone) {
    case "ok":
      return <svg viewBox="0 0 12 12" className={cn(c, "text-ok")} aria-hidden><circle cx="6" cy="6" r="5" fill="currentColor" /></svg>
    case "warn":
      return <svg viewBox="0 0 12 12" className={cn(c, "text-warn-fill")} aria-hidden><path d="M6 1 11.2 10.5H.8Z" fill="currentColor" /></svg>
    case "danger":
      return <svg viewBox="0 0 12 12" className={cn(c, "text-danger")} aria-hidden><path d="M6 .6 11.4 6 6 11.4.6 6Z" fill="currentColor" /></svg>
    case "off":
      return <svg viewBox="0 0 12 12" className={cn(c, "text-danger")} aria-hidden><circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
    default:
      return <svg viewBox="0 0 12 12" className={cn(c, "text-fg-3")} aria-hidden><rect x="1.5" y="1.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
  }
}

export function Status({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <Shape tone={tone} />
      {children}
    </span>
  )
}

/** 작은 꼬리표 (대응 단계 · 모델 이름 등). 모서리 4px */
export function Tag({ tone = "neutral", solid = false, children, className }: { tone?: Tone; solid?: boolean; children: ReactNode; className?: string }) {
  const soft: Record<Tone, string> = {
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    off: "bg-danger-soft text-danger",
    neutral: "bg-fg/[0.06] text-fg-2",
    brand: "bg-brand-soft text-brand",
  }
  const fill: Record<Tone, string> = {
    ok: "bg-ok text-white",
    warn: "bg-warn-fill text-white",
    danger: "bg-danger text-white",
    off: "bg-danger text-white",
    neutral: "bg-fg-2 text-white",
    brand: "bg-brand text-white",
  }
  return <span className={cn("inline-flex h-6 items-center rounded px-1.5 text-xs font-semibold whitespace-nowrap", solid ? fill[tone] : soft[tone], className)}>{children}</span>
}

/** 흰 패널 + 머리줄 */
export function Panel({ title, aside, children, className, bodyClass }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={cn("rounded-lg border border-line bg-surface", className)}>
      {title && (
        <header className="flex min-h-12 items-center gap-3 border-b border-line px-4">
          <h2 className="text-fs15 font-semibold">{title}</h2>
          {aside && <div className="ml-auto flex items-center gap-3 text-sm text-fg-3">{aside}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

/** 진행 단계 (Atlassian progress tracker): 지난 단계 굵은 선 · 현재 단계만 파란 글자 · 남은 단계 점 */
export function Tracker({ steps, current, tone = "brand" }: { steps: { key: string | number; label: ReactNode }[]; current: number; tone?: "brand" | "danger" | "warn" }) {
  const bar = tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn-fill" : "bg-brand"
  const text = tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-brand"
  return (
    <ol className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => (
        <li key={s.key} className="min-w-0" aria-current={i === current ? "step" : undefined}>
          <div className="relative flex h-3 items-center">
            {i <= current ? (
              <div className={cn("h-1 w-full", bar, i === 0 && "rounded-l-full", i === current && "rounded-r-full")} />
            ) : (
              <div className="mx-auto size-1.5 rounded-full bg-fg-3" />
            )}
          </div>
          <div className={cn("mt-1.5 truncate px-0.5 text-center text-fs13", i < current ? "font-semibold text-fg" : i === current ? cn("font-bold", text) : "text-fg-3")}>{s.label}</div>
        </li>
      ))}
    </ol>
  )
}
