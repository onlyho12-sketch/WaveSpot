// ⋮ 메뉴 · 바깥을 누르거나 Esc 로 닫힘, 항목을 누르면 닫힘
import { MoreVertical } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export function Menu({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("pointerdown", out)
    document.addEventListener("keydown", esc)
    return () => {
      document.removeEventListener("pointerdown", out)
      document.removeEventListener("keydown", esc)
    }
  }, [open])
  return (
    <div ref={ref} className={cn("relative", className)}>
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={cn("grid size-8 place-items-center rounded-md text-fg-2 hover:bg-fg/10", open && "bg-fg/10")}>
        <MoreVertical className="size-4" />
      </button>
      {open && (
        <div role="menu" onClick={() => setOpen(false)}
          className="absolute top-9 right-0 z-30 min-w-44 overflow-hidden rounded-md border border-line bg-surface py-1 shadow-[0_6px_20px_rgba(16,24,40,0.25)]">
          {children}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ onClick, children, tone }: { onClick: () => void; children: ReactNode; tone?: "danger" }) {
  return (
    <button type="button" role="menuitem" onClick={onClick}
      className={cn("flex h-11 w-full items-center gap-2.5 px-3 text-left text-sm font-semibold whitespace-nowrap hover:bg-subtle [&_svg]:size-4 [&_svg]:shrink-0",
        tone === "danger" ? "text-danger" : "text-fg")}>
      {children}
    </button>
  )
}
