// 공통 틀 · 태블릿 가로: 왼쪽 내비 레일 / 휴대폰 · 태블릿 세로: 아래 탭
// 내비는 시험 당일 흐름 순서: 시험 전 준비 → 시험 중 감독 · 순회 → 시험 후 기록, 관리는 따로
// 위쪽 줄 가운데 = 지금 단계 (시험 전 · 시험 중 · 시험 후) + 기록 중 표시
// 위쪽 줄은 감독관에게 필요한 것만: 시험 이름 · 장비 상태(v10 상시 표시) · 시각 · 남은 시간
// 배너는 감독관이 움직여야 할 때만 (장비 고장 · 서버 연결 끊김). 모의 데이터 여부는 기획서와 관리 탭(데이터 출처)에만 표기
import { Link, Outlet } from "@tanstack/react-router"
import { Activity, ChevronRight, ClipboardList, Footprints, LayoutGrid, Settings2, TriangleAlert } from "lucide-react"
import type { ReactNode } from "react"
import { Status } from "@/components/ui/status"
import { useLive } from "@/lib/live"
import { cn } from "@/lib/utils"

type Phase = "before" | "during" | "after"
const NAV = [
  { to: "/setup", label: "준비", icon: Settings2, phase: "before" },
  { to: "/", label: "감독", icon: LayoutGrid, phase: "during" },
  { to: "/roam", label: "순회", icon: Footprints, phase: "during" },
  { to: "/log", label: "기록", icon: ClipboardList, phase: "after" },
  { to: "/admin", label: "관리", icon: Activity, phase: null },
] as const
const PHASES: { key: Phase; label: string }[] = [
  { key: "before", label: "시험 전" },
  { key: "during", label: "시험 중" },
  { key: "after", label: "시험 후" },
]

export function AppShell() {
  const status = useLive((s) => s.status)
  const clock = useLive((s) => s.clock)
  const connected = useLive((s) => s.connected)
  const openCount = useLive((s) => Object.values(s.requests).filter((r) => r.state === "open" || r.state === "searching").length)
  const nodes = status?.nodes ?? []
  const total = nodes.length || 4
  const online = nodes.filter((n) => n.status === "online").length
  const down = nodes.filter((n) => n.status !== "online").map((n) => n.node_id)
  const running = clock?.state === "running"
  const phase: Phase = clock?.state === "running" ? "during" : clock?.state === "ended" ? "after" : "before"
  const left = clock ? Math.max(0, clock.duration_min - Math.floor(Math.max(clock.t, 0) / 60)) : null
  const badge = (to: string, cls: string) =>
    to === "/roam" && openCount > 0 && (
      <span className={`absolute grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[11px] font-bold text-white ${cls}`}>{openCount}</span>
    )

  return (
    <div className="flex min-h-dvh">
      <nav aria-label="화면" className="sticky top-0 hidden h-dvh w-[84px] shrink-0 flex-col items-center border-r border-line bg-surface py-3 expanded:flex">
        <img src="/icon.png" alt="WaveSpot" className="size-10 rounded-[10px]" />
        <div className="mt-3 flex w-full flex-1 flex-col px-2">
          {NAV.map(({ to, label, icon: Icon, phase: p }, i) => (
            <div key={to} className={cn(!p && "mt-auto")}>
              {p && p !== NAV[i - 1]?.phase && (
                <div className={cn("mt-3 mb-1 text-center text-[11px] font-semibold", p === phase ? "text-brand" : "text-fg-3")}>
                  {PHASES.find((x) => x.key === p)!.label}
                </div>
              )}
              <Link to={to} activeOptions={{ exact: to === "/" }}
                className="relative flex h-16 flex-col items-center justify-center gap-1 rounded-lg text-xs font-semibold text-fg-2 hover:bg-fg/5 data-[status=active]:bg-brand-soft data-[status=active]:text-brand">
                <Icon className="size-[22px]" strokeWidth={2} />
                {label}
                {badge(to, "top-2 right-3")}
              </Link>
            </div>
          ))}
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] expanded:pb-0">
        <header className="sticky top-0 z-30 border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
          <div className="flex h-14 items-center gap-3 px-4 medium:gap-4 medium:px-5">
            <img src="/icon.png" alt="WaveSpot" className="size-8 rounded-lg expanded:hidden" />
            <div className="min-w-0 truncate text-[15px] font-bold">{status?.session?.name ?? "시험 없음"}</div>

            {/* 지금 단계 */}
            <ol aria-label="시험 단계" className="ml-2 hidden items-center gap-1 text-[13px] large:flex">
              {PHASES.map((x, i) => (
                <li key={x.key} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3.5 text-fg-3" />}
                  <span aria-current={x.key === phase ? "step" : undefined}
                    className={cn("rounded px-2 py-0.5 font-semibold", x.key === phase ? "bg-brand-soft text-brand" : "text-fg-3")}>{x.label}</span>
                </li>
              ))}
            </ol>
            {running && (
              <span className="hidden items-center gap-1.5 text-[13px] font-semibold medium:flex">
                {clock?.paused ? <><span className="size-2 rounded-full bg-fg-3" />일시 정지</> : <><span className="size-2 animate-pulse rounded-full bg-danger" />기록 중</>}
              </span>
            )}

            <div className="ml-auto flex items-center gap-4 text-sm">
              <Status tone={online === total ? "ok" : "danger"}>
                <span className="hidden text-fg-3 medium:inline">수신기</span>
                <span className="num font-semibold">{online}/{total}</span>
              </Status>
              <span className="hidden medium:inline-flex">
                <Status tone={status?.beacon_ok ? "ok" : "danger"}>
                  <span className="text-fg-3">비콘</span>
                  <span className="font-semibold">{status?.beacon_ok ? "정상" : "끊김"}</span>
                </Status>
              </span>
            </div>

            <div className="border-l border-line pl-3 text-right medium:pl-4">
              <div className="num text-xl leading-none font-bold medium:text-[22px]">{running || clock?.state === "ended" ? clock!.clock.slice(0, 5) : "--:--"}</div>
              <div className="num mt-1 text-xs text-fg-3">{running ? `남은 ${left}분` : clock?.state === "ended" ? "종료" : "시작 전"}</div>
            </div>
          </div>

          {!connected && <Banner>서버 연결 끊김 · 다시 연결하는 중</Banner>}
          {connected && nodes.length > 0 && online < total && <Banner>수신기 {down.join(" · ")} 꺼짐 · 전원과 연결을 확인하세요</Banner>}
        </header>

        <main className="flex-1 p-3 medium:p-4">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] expanded:hidden" aria-label="화면">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} activeOptions={{ exact: to === "/" }}
            className="relative flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold text-fg-3 data-[status=active]:text-brand">
            <Icon className="size-[22px]" />
            {label}
            {badge(to, "top-2 left-1/2 ml-2")}
          </Link>
        ))}
      </nav>
    </div>
  )
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-center gap-2 bg-danger px-4 py-2 text-sm font-semibold text-white medium:px-5">
      <TriangleAlert className="size-4 shrink-0" />
      {children}
    </div>
  )
}
