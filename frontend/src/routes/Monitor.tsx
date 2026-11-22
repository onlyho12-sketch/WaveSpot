// 감독 메인 · 감독관이 볼 것만: 지금 문제가 있나 → 어디를 → 무엇을 할지
// 배치: 왼쪽 어두운 감독실 = 상단 정보 + 상태별 카운터 + 좌석 배치도 + 교시 타임라인
//                          오른쪽 '에이전트 무선신호 감지' 패널 = 에이전트가 무선 신호로 찾은 반입 금지 기기 카드 목록 (없으면 '이상 없음' 한 장)
// 휴대폰: 에이전트 무선신호 감지가 먼저, 아래에 작은 감독실
// v11 10장: 시스템이 멈추면 '이상 없음'이 아니라 '감지 중단 · 복구 중 · 위치 추정 중지'를 크게 보여 줌
//           허용 목록은 시험이 시작되면 잠김 (입실 후 나타난 기기는 등록 불가) → 시험 중 '허용 목록 추가' 메뉴 없음
import { Link, useNavigate } from "@tanstack/react-router"
import { ChevronRight, ClipboardCheck, Eye, FileText, Footprints, MapPinOff, RefreshCw, ShieldCheck, WifiOff } from "lucide-react"
import { Pulse } from "./Admin"
import { useMemo, useState } from "react"
import { AgentLog } from "@/components/monitor/AgentLog"
import { EvidenceSheet, RequestCard } from "@/components/monitor/RequestCard"
import { SeatMap, type SeatState, type ZoneMark } from "@/components/monitor/SeatMap"
import { StateTimeline } from "@/components/monitor/StateTimeline"
import { Button } from "@/components/ui/button"
import { MenuItem } from "@/components/ui/menu"
import { useChangeCount } from "@/lib/motion"
import { Panel, Shape } from "@/components/ui/status"
import { getRole, type AgentEvent, type Clock, type Health, type SearchRequest, type TrackedDevice } from "@/lib/api"
import { canRecord, canSee } from "@/lib/roles"
import { useLive } from "@/lib/live"
import { useIsPhone } from "@/lib/useIsPhone"
import { clockOf, cn, dateLabel, isOpen, type Tone } from "@/lib/utils"

/** 기기가 처음 잡힌 뒤 지난 시간 → "40초 지속" · "3분 지속" */
function lasting(events: AgentEvent[], deviceId: string, now: number) {
  let first = Infinity
  for (const e of events) if (e.device_id === deviceId && e.sim_time >= 0 && e.sim_time < first) first = e.sim_time
  if (!Number.isFinite(first)) return null
  const s = Math.max(0, Math.round(now - first))
  return s < 60 ? `${s}초 지속` : `${Math.floor(s / 60)}분 지속`
}

const evidenceCount = (r: SearchRequest) => r.evidence.filter((e) => e.label !== "조사 기록" && e.label !== "추정 위치").length

export function Monitor() {
  const status = useLive((s) => s.status)
  const clock = useLive((s) => s.clock)
  const devices = useLive((s) => s.devices)
  const requestsMap = useLive((s) => s.requests)
  const events = useLive((s) => s.events)
  const handheld = useLive((s) => s.handheld)
  const phone = useIsPhone()
  const navigate = useNavigate()
  const [sheet, setSheet] = useState<number | null>(null)
  const health = status?.health
  const wide = health?.mode === "degraded" // 수신기 1대 끊김: 범위를 한 단계 넓혀 표시

  const requests = useMemo(() => Object.values(requestsMap).sort((a, b) => b.id - a.id), [requestsMap])
  const open = requests.filter(isOpen)
  const closed = requests.filter((r) => !isOpen(r))
  const session = status?.session
  const start = session?.exam_start_label ?? "09:00"
  const now = clock?.t ?? 0

  // 범위 머리 상태 문구: 관찰 중 · 18초 지속 / 수색 구역 · 근거 4개
  const zones = useMemo<ZoneMark[]>(() => {
    const z: ZoneMark[] = []
    for (const r of open) {
      z.push({ zone: r.zone, kind: r.level >= 3 ? "request" : "candidate", label: `${r.zone2 ? "1순위" : "수색 범위"} (근거 ${evidenceCount(r)}개)`, wide })
      if (r.zone2 && !z.some((m) => m.zone === r.zone2)) z.push({ zone: r.zone2, kind: "candidate", label: "2순위", wide })
    }
    for (const d of devices)
      if (d.level === 1 && d.zone != null && !z.some((m) => m.zone === d.zone)) {
        const t = lasting(events, d.device_id, now)
        z.push({ zone: d.zone, kind: "watch", label: t ? `관찰 중 (${t})` : "관찰 중", wide })
      }
    return z
  }, [open, devices, events, now, wide])

  const seats = useMemo(() => {
    const s: Record<number, SeatState> = {}
    for (const r of requests) {
      if (r.state === "found" && r.found_seat) s[r.found_seat] = "found"
      else if (r.state === "not_found" && r.suspect_seat) s[r.suspect_seat] ??= "cleared"
      else if (r.state === "searching") {
        const p = handheld[r.id]?.step?.pos_seat
        if (p) s[p] = "probe"
      } else if (r.state === "open" && r.suspect_seat && r.level >= 3) s[r.suspect_seat] = "suspect"
    }
    return s
  }, [requests, handheld])

  const nodes = Object.fromEntries((status?.nodes ?? []).map((n) => [n.node_id, n.status === "online"]))

  /** 범위 ⋮ 메뉴: 휴대형 접근 · 근거 보기 · 결과 입력 (허용 목록은 시험 중 잠김) */
  const zoneMenu = (z: number) => {
    const r = open.find((q) => q.zone === z || q.zone2 === z)
    if (!r) return null
    const goRoam = (id: number) => navigate({ to: "/roam/$id", params: { id: String(id) } })
    const rec = canRecord(getRole()) // 순회 · 결과 입력은 감독관만 (관리자는 근거만 봄)
    return (
      <>
        {rec && <MenuItem onClick={() => goRoam(r.id)}><Footprints />{r.state === "searching" ? "순회 화면" : "휴대형 접근"}</MenuItem>}
        <MenuItem onClick={() => setSheet(r.id)}><FileText />근거 보기</MenuItem>
        {rec && r.level >= 3 && r.suspect_seat && <MenuItem onClick={() => goRoam(r.id)}><ClipboardCheck />결과 입력</MenuItem>}
      </>
    )
  }

  if (session && (session.state === "setup" || session.state === "baseline")) {
    return (
      <Panel className="mx-auto mt-6 max-w-xl medium:mt-10" bodyClass="p-6 medium:p-8">
        <h1 className="text-2xl font-bold">시험 시작 전</h1>
        {session.state === "setup" && <p className="mt-2 text-fg-2">자가 점검과 허용 기기 등록을 마친 뒤 시작하세요.</p>}
        <Button asChild size="lg" className="mt-6"><Link to="/setup">준비 화면으로 <ChevronRight /></Link></Button>
      </Panel>
    )
  }

  const watching = devices.filter((d) => d.level === 1).length
  const duration = clock?.duration_min ?? session?.duration_min ?? 40

  return (
    // 태블릿 가로 이상: 페이지 스크롤 없이 한 화면 (창 높이 - 위쪽 줄(배너 포함) - 본문 여백)
    //   오른쪽 칸: 요청 카드가 먼저 자리를 잡고, 최근 판단은 남은 높이만큼 (넘치면 그 칸 안에서만 스크롤)
    <div className="grid gap-3 medium:gap-4 expanded:h-[calc(100dvh-var(--shell-top,57px)-2rem)] expanded:min-h-[520px] expanded:grid-cols-[minmax(0,1fr)_360px] expanded:grid-rows-[minmax(0,1fr)] large:grid-cols-[minmax(0,1fr)_400px]">
      {/* 에이전트 감지 패널 */}
      <aside className="flex flex-col gap-3 medium:gap-4 expanded:order-2 expanded:min-h-0">
        <section className="overflow-hidden rounded-lg border border-line bg-surface expanded:min-h-0 expanded:overflow-y-auto">
          <header className="flex min-h-14 items-center gap-2 border-b border-line bg-surface px-4 py-2 expanded:sticky expanded:top-0 expanded:z-10">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-fs15 leading-tight font-semibold">
                에이전트 감지
                {open.length > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-xs font-bold text-white">{open.length}</span>}
              </h2>
              <p className="truncate text-fs12 text-fg-3">무선 신호로 찾은 반입 금지 기기</p>
            </div>
            <AgentPulse devices={devices} clock={clock} last={events.at(-1)?.clock ?? null} />
          </header>

          {/* 장애 중에는 '이상 없음'을 띄우지 않음 */}
          {health && health.mode !== "normal" && health.mode !== "degraded" && <div className="p-3 pb-0"><HealthCard health={health} /></div>}
          {open.length === 0 ? (
            (!health || health.mode === "normal" || health.mode === "degraded") && <div className="p-3"><StatusCard watching={watching > 0} /></div>
          ) : (
            <div className="mt-3 divide-y divide-line border-t border-line first:mt-0 first:border-t-0">
              {open.map((r) => <RequestCard key={r.id} req={r} startLabel={start} flush />)}
            </div>
          )}
          {open.length === 0 && health && health.mode !== "normal" && health.mode !== "degraded" && <div className="h-3" />}

          {closed.length > 0 && (
            <div className="border-t border-line">
              <h3 className="bg-subtle px-4 py-2 text-fs13 font-semibold text-fg-3">처리한 요청 {closed.length}</h3>
              <div className="divide-y divide-line">
                {closed.slice(0, 3).map((r) => <RequestCard key={r.id} req={r} startLabel={start} flush />)}
              </div>
            </div>
          )}
        </section>

        {/* 시각순 판단 기록 (Cellbusters · Verkada · Talview: 감독 화면 한쪽에 늘 알림 목록) · 휴대폰은 좌석도가 먼저라 뺌 */}
        {!phone && (
          <Panel title="최근 에이전트 판단" aside={<Link to="/log" className="flex items-center gap-0.5 text-fs13 font-semibold text-fg-2 hover:text-fg">전체 기록<ChevronRight className="size-4" /></Link>}
            className="expanded:flex expanded:min-h-[7rem] expanded:flex-1 expanded:flex-col" bodyClass="expanded:min-h-0 expanded:flex-1 expanded:overflow-y-auto">
            <AgentLog events={events.filter((e) => e.sim_time >= 0)} limit={30} dense />
          </Panel>
        )}
      </aside>

      {/* 감독실 (어두운 면) */}
      <section aria-label="감독실" className="room overflow-hidden rounded-lg expanded:order-1 expanded:min-h-0 expanded:overflow-y-auto">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-4 medium:px-5">
          <div className="min-w-0">
            <h2 className="text-fs17 font-bold">좌석 배치 ({(session?.rows ?? 4) * (session?.cols ?? 10)}석)</h2>
            <div className="num mt-0.5 text-fs13 text-fg-3">
              {[dateLabel(session?.exam_date), `${start} ~ ${clockOf(duration * 60, start)} (${duration}분)`, session?.place].filter(Boolean).join(", ")}
            </div>
          </div>
          {open.length > 0 && canRecord(getRole()) && (
            <Button asChild size="sm" className="ml-auto bg-brand-soft text-brand hover:bg-brand-soft/70">
              <Link to="/roam"><Footprints />순회 화면</Link>
            </Button>
          )}
        </header>

        {/* 장비 상태는 위쪽 줄 · 장애 배너에 있고, 허용 목록 수는 감독관이 할 일과 무관 → 여기서는 뺌 */}
        <Counts
          cells={[
            { label: "관찰 중", value: watching, tone: watching > 0 ? "warn" : undefined },
            { label: "수색 요청", value: open.length, tone: open.length > 0 ? "danger" : undefined },
            { label: "처리 완료", value: closed.length },
          ]}
        />

        <div className="border-t border-line p-3 medium:p-5">
          {/* 창이 낮으면 좌석도 너비를 줄여 높이를 맞춤 (좌석도 높이 ≈ 너비 × 0.52 + 교탁 줄 · 나머지 머리줄 · 범례 · 타임라인 ≈ 380px) */}
          <div className="mx-auto expanded:max-w-[calc((100dvh_-_var(--shell-top,57px)_-_380px)*1.9_+_112px)]">
            <SeatMap rows={session?.rows ?? 4} cols={session?.cols ?? 10} zones={zones} seats={seats} nodes={nodes} compact={phone} zoneMenu={phone ? undefined : zoneMenu} />
          </div>
          {!phone && (
            <div className="mt-5 border-t border-line pt-4">
              <StateTimeline clock={clock} events={events} requests={requests} startLabel={start} />
            </div>
          )}
        </div>
      </section>

      {sheet != null && requestsMap[sheet] && <EvidenceSheet req={requestsMap[sheet]} open onOpenChange={(o) => !o && setSheet(null)} />}
    </div>
  )
}

type Cell = { label: string; value: string | number; tone?: Tone }

/** 상태 개수 한 줄 (칸 · 배경 없이 '이름 숫자'). 0이면 회색 글자, 할 일이 생긴 항목만 모양 + 색 */
function Counts({ cells }: { cells: Cell[] }) {
  return (
    <div className="flex items-center px-4 pt-2 pb-3 text-fs14 medium:px-5">
      {cells.map((c, i) => <CountItem key={c.label} c={c} first={i === 0} />)}
    </div>
  )
}

/** 값이 바뀌면 숫자만 아래에서 올라옴 (화면에 들어올 때는 재생 안 함) */
function CountItem({ c, first }: { c: Cell; first: boolean }) {
  const changed = useChangeCount(c.value)
  const color = c.tone === "danger" ? "text-danger" : c.tone === "warn" ? "text-warn" : null
  return (
    <div className={cn("flex items-center gap-1.5 whitespace-nowrap", !first && "ml-4 border-l border-line pl-4")}>
      {c.tone && <Shape tone={c.tone} className="size-2.5" />}
      <span className={color ?? "text-fg-3"}>{c.label}</span>
      <span key={changed} className={cn("num inline-block font-semibold", changed > 0 && "animate-tick", color ?? "text-fg-2")}>{c.value}</span>
    </div>
  )
}

/** 요청이 없을 때만 보이는 한 줄 (Stephen Few: '할 일 없음'은 작게 · 큰 배너 금지)
 *  이상 없음 = 회색 · 관찰 중 = 연한 주황 테두리 (색은 이상이 있을 때만) */
function StatusCard({ watching }: { watching: boolean }) {
  const Icon = watching ? Eye : ShieldCheck
  return (
    <div aria-live="polite" className={cn("flex items-center gap-3 rounded-md border px-3.5 py-3",
      watching ? "border-warn-fill/50 bg-warn-soft" : "border-line bg-subtle")}>
      <Icon className={cn("size-5 shrink-0", watching ? "text-warn" : "text-fg-3")} strokeWidth={2.2} />
      <div className="min-w-0">
        <div className={cn("text-fs15 leading-tight font-semibold", watching ? "text-warn" : "text-fg")}>{watching ? "관찰 중" : "이상 없음"}</div>
        <div className="text-fs13 text-fg-3">{watching ? "의심 신호를 지켜보는 중, 아직 조치 필요 없음" : "반입 금지 기기 신호 없음"}</div>
      </div>
    </div>
  )
}

/** 자동 탐지가 멈추거나 줄었을 때 '이상 없음' 대신 보이는 카드 (v11 10장 · 해킹 · 장애 ≠ 이상 없음) */
function HealthCard({ health }: { health: Health }) {
  const c = {
    manual: { Icon: WifiOff, bg: "bg-danger", title: "감지 중단", sub: "시험장 망 끊김. 순회와 금속탐지기로 직접 감독하세요" },
    recovering: { Icon: RefreshCw, bg: "bg-warn-fill", title: "복구 중", sub: "현장 서버 재시작. 저장된 상태로 곧 이어서 판단" },
    no_location: { Icon: MapPinOff, bg: "bg-danger", title: "위치 추정 중지", sub: `수신기 ${health.nodes_ok}/4. 반입 금지 기기가 있는지만 판단하니 휴대형으로 교실 전체를 순회하세요` },
  }[health.mode as "manual" | "recovering" | "no_location"]
  if (!c) return null
  return (
    <div role="alert" className={cn("flex items-center gap-3 rounded-md px-4 py-5 text-white", c.bg)}>
      <c.Icon className={cn("size-9 shrink-0", health.mode === "recovering" && "animate-spin [animation-duration:2.5s]")} strokeWidth={2.2} />
      <div>
        <div className="text-fs24 leading-tight font-bold">{c.title}</div>
        <div className="text-fs14 opacity-95">{c.sub}</div>
      </div>
    </div>
  )
}

/** 에이전트가 돌고 있다는 것만 (자세한 흐름은 관리 탭) */
function AgentPulse({ devices, clock, last }: { devices: TrackedDevice[]; clock: Clock | null; last: string | null }) {
  const live = clock?.state === "running" && !clock.paused
  const n = devices.length
  const title = n > 0 ? `신호 ${n}개 확인 중` : "새 신호 없음"
  const body = (
    <>
      <Pulse on={live} />
      <span className="font-semibold text-fg-2">{live ? "작동 중" : clock?.paused ? "일시 정지" : "대기"}</span>
      {last && <span className="num hidden medium:inline">{last.slice(0, 5)}</span>}
    </>
  )
  // 관리 화면을 볼 수 없는 계정(감독관)은 눌러도 갈 곳이 없으므로 표시만
  if (!canSee(getRole(), "/admin"))
    return <div title={title} className="ml-auto flex items-center gap-2 px-2 py-1 text-fs13 text-fg-3">{body}</div>
  return (
    <Link to="/admin" title={title} className="ml-auto flex items-center gap-2 rounded-md px-2 py-1 text-fs13 text-fg-3 hover:bg-subtle">
      {body}
      <ChevronRight className="size-4 shrink-0" />
    </Link>
  )
}
