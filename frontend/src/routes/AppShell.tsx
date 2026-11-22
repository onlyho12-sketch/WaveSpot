// 공통 틀 · 태블릿 가로: 왼쪽 내비 레일 / 휴대폰 · 태블릿 세로: 아래 탭
// 내비는 시험 당일 흐름 순서: 시험 전 준비 → 시험 중 감독 · 순회 → 시험 후 기록, 관리는 따로
// 위쪽 줄 가운데 = 지금 단계 (시험 전 · 시험 중 · 시험 후) + 기록 중 표시
// 위쪽 줄은 감독관에게 필요한 것만: 시험 이름 · 장비 상태(v10 상시 표시) · 시각 · 남은 시간
// 배너는 감독관이 움직여야 할 때만 (장비 고장 · 서버 연결 끊김). 모의 데이터 여부는 기획서와 관리 탭(데이터 출처)에만 표기
// v11 10장 단계적 축소: 장애마다 '무엇이 멈췄고 감독관이 뭘 하면 되는지' 한 줄. 멈추면 조용히 '이상 없음'이 되지 않음
//   빨강 = 감독관이 움직여야 함 (감시 중단 · 위치 추정 중지 · 수신기 꺼짐) / 주황 = 자동으로 처리 중 (복구 중 · 보정 정지 · 규칙 점수)
import { Link, Outlet } from "@tanstack/react-router"
import { Activity, ChevronRight, ClipboardList, CloudUpload, Footprints, LayoutGrid, RefreshCw, Settings2, TriangleAlert } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Shape, Status } from "@/components/ui/status"
import type { Health } from "@/lib/api"
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

/** 일시 정지 표시: 평소엔 회색, 1분 넘게 멈춰 있으면 주황 ▲ + 멈춘 시간 (Stephen Few: 갱신을 멈췄다는 걸 잊지 않게) */
const PAUSE_WARN_S = 60
function PausedLabel() {
  const [since] = useState(() => Date.now())
  const [now, setNow] = useState(since)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])
  const s = Math.floor((now - since) / 1000)
  if (s < PAUSE_WARN_S) return <><span className="size-2 rounded-full bg-fg-3" />일시 정지</>
  return <span className="flex items-center gap-1.5 text-warn"><Shape tone="warn" className="size-2.5" />일시 정지 {Math.floor(s / 60)}분째</span>
}

export function AppShell() {
  const status = useLive((s) => s.status)
  const clock = useLive((s) => s.clock)
  const connected = useLive((s) => s.connected)
  const outbox = useLive((s) => s.outbox.length)
  const resynced = useLive((s) => s.resynced)
  const health = status?.health
  const openCount = useLive((s) => Object.values(s.requests).filter((r) => r.state === "open" || r.state === "searching").length)
  const nodes = status?.nodes ?? []
  const total = nodes.length || 4
  const online = nodes.filter((n) => n.status === "online").length
  const down = nodes.filter((n) => n.status !== "online").map((n) => n.node_id)
  const running = clock?.state === "running"
  const phase: Phase = clock?.state === "running" ? "during" : clock?.state === "ended" ? "after" : "before"
  const left = clock ? Math.max(0, clock.duration_min - Math.floor(Math.max(clock.t, 0) / 60)) : null
  // 위쪽 줄(장애 배너 포함) 높이 → --shell-top · 감독 화면이 남은 높이를 꽉 채우는 데 씀 (배너가 뜨면 높이가 바뀜)
  const headerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--shell-top", `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const badge = (to: string, cls: string) =>
    to === "/roam" && openCount > 0 && (
      <span className={`absolute grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-fs11 font-bold text-white ${cls}`}>{openCount}</span>
    )

  return (
    <div className="flex min-h-dvh">
      <nav aria-label="화면" className="sticky top-0 hidden h-dvh w-[84px] shrink-0 flex-col items-center border-r border-line bg-surface py-3 expanded:flex">
        <img src="/icon.png" alt="WaveSpot" className="size-10 rounded-[10px]" />
        <div className="mt-3 flex w-full flex-1 flex-col px-2">
          {NAV.map(({ to, label, icon: Icon, phase: p }, i) => (
            <div key={to} className={cn(!p && "mt-auto")}>
              {p && p !== NAV[i - 1]?.phase && (
                <div className={cn("mt-3 mb-1 text-center text-fs11 font-semibold", p === phase ? "text-brand" : "text-fg-3")}>
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
        <header ref={headerRef} className="sticky top-0 z-30 border-b border-line bg-surface pt-[env(safe-area-inset-top)]">
          <div className="flex h-14 items-center gap-3 px-4 medium:gap-4 medium:px-5">
            <img src="/icon.png" alt="WaveSpot" className="size-8 rounded-lg expanded:hidden" />
            <div className="min-w-0 truncate text-fs15 font-bold">{status?.session?.name ?? "시험 없음"}</div>

            {/* 지금 단계 */}
            <ol aria-label="시험 단계" className="ml-2 hidden items-center gap-1 text-fs13 large:flex">
              {PHASES.map((x, i) => (
                <li key={x.key} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="size-3.5 text-fg-3" />}
                  <span aria-current={x.key === phase ? "step" : undefined}
                    className={cn("rounded px-2 py-0.5 font-semibold", x.key === phase ? "bg-brand-soft text-brand" : "text-fg-3")}>{x.label}</span>
                </li>
              ))}
            </ol>
            {running && (
              <span className="hidden items-center gap-1.5 text-fs13 font-semibold medium:flex">
                {clock?.paused ? <PausedLabel /> : <><span className="size-2 rounded-full bg-fg-2" />기록 중</>}
              </span>
            )}

            <div className="ml-auto flex items-center gap-4 text-sm">
              {outbox > 0 && (
                <span className="flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-1 text-fs13 font-semibold text-warn" title="저장 확인을 못 받은 수색 결과입니다. 태블릿에 저장해 두고 연결되면 자동 전송">
                  <CloudUpload className="size-4" />전송 대기 <span className="num">{outbox}</span>건
                </span>
              )}
              <Status tone={online === total ? "ok" : "danger"}>
                <span className="hidden text-fg-3 medium:inline">수신기</span>
                <span className="num font-semibold">{online}/{total}</span>
              </Status>
              <span className="hidden medium:inline-flex">
                <Status tone={health?.beacon === "frozen" ? "warn" : status?.beacon_ok ? "ok" : "danger"}>
                  <span className="text-fg-3">비콘</span>
                  <span className="font-semibold">{health?.beacon === "frozen" ? "보정 정지" : status?.beacon_ok ? "정상" : "끊김"}</span>
                </Status>
              </span>
            </div>

            <div className="border-l border-line pl-3 text-right medium:pl-4">
              <div className="num text-xl leading-none font-bold medium:text-fs22">{running || clock?.state === "ended" ? clock!.clock.slice(0, 5) : "--:--"}</div>
              <div className="num mt-1 text-xs text-fg-3">{running ? `남은 ${left}분` : clock?.state === "ended" ? "종료" : "시작 전"}</div>
            </div>
          </div>

          {!connected ? (
            <Banner>앱 연결이 끊겨 다시 연결하는 중입니다. 그동안 휴대형 수신기가 진동과 LED로 알립니다</Banner>
          ) : (
            <HealthBanners health={health} down={down} running={running} nodeTrouble={nodes.length > 0 && online < total} />
          )}
          {connected && resynced != null && resynced > 0 && (
            <Banner tone="info"><RefreshCw className="size-4 shrink-0" />다시 연결됨. 끊긴 동안 놓친 알림 {resynced}건을 다시 받았습니다</Banner>
          )}
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

/** 장애 상황별 한 줄 (설계안 v11 10장 '감독관 화면' 열) */
function HealthBanners({ health, down, running, nodeTrouble }: { health?: Health; down: string[]; running: boolean; nodeTrouble: boolean }) {
  if (!health) return nodeTrouble ? <Banner>수신기 {down.join(", ")} 꺼짐, 전원과 연결을 확인하세요</Banner> : null
  const list: ReactNode[] = []
  if (health.mode === "manual")
    list.push(<Banner key="manual"><b>감시 중단 (수동 감독 모드)</b> — 시험장 망이 끊겨 자동 탐지가 멈췄습니다. 순회와 금속탐지기로 직접 감독하세요. 수신기는 계속 기록 중</Banner>)
  else if (health.mode === "recovering")
    list.push(<Banner key="rec" tone="warn"><RefreshCw className="size-4 shrink-0 animate-spin" />현장 서버 복구 중. 마지막 저장 상태{health.checkpoint ? `(${health.checkpoint.slice(0, 5)})` : ""}로 이어서 판단합니다. 30초 안에 자동 해제</Banner>)
  if (running && health.mode === "no_location")
    list.push(<Banner key="noloc">수신기 {down.join(", ")} 꺼짐. <b>위치 추정 중지</b> — 반입 금지 기기가 있는지만 판단합니다. 휴대형으로 교실 전체를 순회하세요</Banner>)
  else if (running && health.mode === "degraded")
    list.push(<Banner key="deg">수신기 {down.join(", ")} 꺼짐. 남은 3대로 위치를 계산합니다 (범위를 넓게 표시). 전원과 연결을 확인하세요</Banner>)
  else if (!running && nodeTrouble)
    list.push(<Banner key="node">수신기 {down.join(", ")} 꺼짐, 전원과 연결을 확인하세요</Banner>)
  if (health.beacon === "frozen")
    list.push(<Banner key="beacon" tone="warn">기준 비콘 이상. 세기 보정을 멈추고 직전 보정값으로 계속 판단합니다. 쉬는 시간에 비콘을 교체하세요</Banner>)
  if (health.model_rule)
    list.push(<Banner key="model" tone="warn">AI 위치 모델 이상. 이 모델만 규칙 점수로 대신 판단 중 (판단 근거에 '규칙 점수' 표시)</Banner>)
  return <>{list}</>
}

function Banner({ children, tone = "danger" }: { children: ReactNode; tone?: "danger" | "warn" | "info" }) {
  return (
    <div role={tone === "info" ? "status" : "alert"}
      className={cn("flex items-center gap-2 px-4 py-2 text-sm font-semibold medium:px-5",
        tone === "danger" ? "bg-danger text-white" : tone === "warn" ? "bg-warn-soft text-warn" : "bg-brand-soft text-brand")}>
      {tone !== "info" && <TriangleAlert className="size-4 shrink-0" />}
      <span className="min-w-0">{children}</span>
    </div>
  )
}
