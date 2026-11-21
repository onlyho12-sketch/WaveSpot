// 감독 메인 · 감독관이 볼 것만: 지금 문제가 있나 → 어디를 → 무엇을 할지
// 배치: 왼쪽 어두운 감독실 = 상단 정보 + 상태별 카운터 + 좌석 배치도 + 교시 타임라인
//                          오른쪽 'AI 감지' 패널 = 점수 배지 카드 목록 (없으면 '이상 없음' 한 장)
// 휴대폰: AI 감지가 먼저, 아래에 작은 감독실
import { Link, useNavigate } from "@tanstack/react-router"
import { ChevronRight, ClipboardCheck, Eye, FileText, Footprints, ShieldCheck, ShieldPlus } from "lucide-react"
import { Pulse } from "./Admin"
import { useMemo, useState } from "react"
import { EvidenceSheet, RequestCard, target } from "@/components/monitor/RequestCard"
import { SeatMap, type SeatState, type ZoneMark } from "@/components/monitor/SeatMap"
import { StateTimeline } from "@/components/monitor/StateTimeline"
import { Button } from "@/components/ui/button"
import { Confirm } from "@/components/ui/confirm"
import { MenuItem } from "@/components/ui/menu"
import { Panel, Shape } from "@/components/ui/status"
import type { AgentEvent, Clock, SearchRequest, TrackedDevice } from "@/lib/api"
import { api } from "@/lib/api"
import { patchStatus, useLive } from "@/lib/live"
import { useIsPhone } from "@/lib/useIsPhone"
import { clockOf, cn, isOpen, type Tone } from "@/lib/utils"

/** 기기가 처음 잡힌 뒤 지난 시간 → "40초 지속" · "3분 지속" */
function lasting(events: AgentEvent[], deviceId: string, now: number) {
  let first = Infinity
  for (const e of events) if (e.device_id === deviceId && e.sim_time >= 0 && e.sim_time < first) first = e.sim_time
  if (!Number.isFinite(first)) return null
  const s = Math.max(0, Math.round(now - first))
  return s < 60 ? `${s}초 지속` : `${Math.floor(s / 60)}분 지속`
}

const evidenceCount = (r: SearchRequest) => r.evidence.filter((e) => e.label !== "조사 기록" && e.label !== "대략 구역").length

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
  const [allow, setAllow] = useState<{ device_id: string; what: string } | null>(null)
  const [allowBusy, setAllowBusy] = useState(false)

  const requests = useMemo(() => Object.values(requestsMap).sort((a, b) => b.id - a.id), [requestsMap])
  const open = requests.filter(isOpen)
  const closed = requests.filter((r) => !isOpen(r))
  const session = status?.session
  const start = session?.exam_start_label ?? "09:00"
  const now = clock?.t ?? 0

  // 구역 머리 상태 문구: 관찰 중 · 18초 지속 / 수색 구역 · 근거 4개
  const zones = useMemo<ZoneMark[]>(() => {
    const z: ZoneMark[] = []
    for (const r of open) {
      z.push({ zone: r.zone, kind: r.level >= 3 ? "request" : "candidate", label: `${r.zone2 ? "1순위" : "수색 구역"} · 근거 ${evidenceCount(r)}개` })
      if (r.zone2 && !z.some((m) => m.zone === r.zone2)) z.push({ zone: r.zone2, kind: "candidate", label: "2순위" })
    }
    for (const d of devices)
      if (d.level === 1 && !z.some((m) => m.zone === d.zone)) {
        const t = lasting(events, d.device_id, now)
        z.push({ zone: d.zone, kind: "watch", label: t ? `관찰 중 · ${t}` : "관찰 중" })
      }
    return z
  }, [open, devices, events, now])

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

  /** 구역 ⋮ 메뉴: 휴대형 접근 · 근거 보기 · 결과 입력 · 허용 목록 추가 */
  const zoneMenu = (z: number) => {
    const r = open.find((q) => q.zone === z || q.zone2 === z)
    const d = devices.find((x) => x.zone === z && x.level >= 1 && x.request_id == null)
    if (!r && !d) return null
    const goRoam = (id: number) => navigate({ to: "/roam/$id", params: { id: String(id) } })
    return (
      <>
        {r && <MenuItem onClick={() => goRoam(r.id)}><Footprints />{r.state === "searching" ? "순회 화면" : "휴대형 접근"}</MenuItem>}
        {r && <MenuItem onClick={() => setSheet(r.id)}><FileText />근거 보기</MenuItem>}
        {r && r.level >= 3 && r.suspect_seat && <MenuItem onClick={() => goRoam(r.id)}><ClipboardCheck />결과 입력</MenuItem>}
        <MenuItem onClick={() => setAllow(r ? { device_id: r.device_id, what: `${target(r)} · ${r.kind} 추정` } : { device_id: d!.device_id, what: `${z}구역 · ${d!.kind} 추정` })}>
          <ShieldPlus />허용 목록 추가
        </MenuItem>
      </>
    )
  }

  async function confirmAllow() {
    if (!allow) return
    setAllowBusy(true)
    try {
      patchStatus(await api.allow(allow.device_id))
      setAllow(null)
    } finally {
      setAllowBusy(false)
    }
  }

  if (session && (session.state === "setup" || session.state === "baseline")) {
    return (
      <Panel className="mx-auto mt-6 max-w-xl medium:mt-10" bodyClass="p-6 medium:p-8">
        <h1 className="text-2xl font-bold">시험 시작 전</h1>
        <p className="mt-2 text-fg-2">{session.state === "setup" ? "장비 확인과 기준선을 마친 뒤 시작하세요." : "기준선 완료. 시험을 시작하세요."}</p>
        <Button asChild size="lg" className="mt-6"><Link to="/setup">준비 화면으로 <ChevronRight /></Link></Button>
      </Panel>
    )
  }

  const nodeList = status?.nodes ?? []
  const total = nodeList.length || 4
  const online = nodeList.filter((n) => n.status === "online").length
  const watching = devices.filter((d) => d.level === 1).length
  const duration = clock?.duration_min ?? session?.duration_min ?? 100

  return (
    <div className="grid gap-3 medium:gap-4 expanded:grid-cols-[minmax(0,1fr)_360px] large:grid-cols-[minmax(0,1fr)_400px]">
      {/* AI 감지 패널 */}
      <aside className="expanded:order-2">
        <section className="overflow-hidden rounded-lg border border-line bg-surface">
          <header className="flex min-h-12 items-center gap-2 border-b border-line px-4">
            <h2 className="text-[15px] font-semibold">AI 감지</h2>
            {open.length > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1.5 text-xs font-bold text-white">{open.length}</span>}
            <AgentPulse devices={devices} clock={clock} last={events.at(-1)?.clock ?? null} />
          </header>

          {open.length === 0 ? (
            <div className="p-3"><StatusCard watching={watching > 0} /></div>
          ) : (
            <div className="divide-y divide-line">
              {open.map((r) => <RequestCard key={r.id} req={r} startLabel={start} flush />)}
            </div>
          )}

          {closed.length > 0 && (
            <div className="border-t border-line">
              <h3 className="bg-subtle px-4 py-2 text-[13px] font-semibold text-fg-3">처리한 요청 {closed.length}</h3>
              <div className="divide-y divide-line">
                {closed.slice(0, 3).map((r) => <RequestCard key={r.id} req={r} startLabel={start} flush />)}
              </div>
            </div>
          )}
        </section>
      </aside>

      {/* 감독실 (어두운 면) */}
      <section aria-label="감독실" className="room overflow-hidden rounded-lg expanded:order-1">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-4 medium:px-5">
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold">좌석 배치 · {(session?.rows ?? 4) * (session?.cols ?? 10)}석</h2>
            <div className="num mt-0.5 text-[13px] text-fg-3">{start} ~ {clockOf(duration * 60, start)} · {duration}분</div>
          </div>
          {open.length > 0 && (
            <Button asChild size="sm" className="ml-auto bg-brand-soft text-brand hover:bg-brand-soft/70">
              <Link to="/roam"><Footprints />순회 화면</Link>
            </Button>
          )}
        </header>

        <Counters
          compact={phone}
          groups={[
            {
              title: "장비",
              cells: [
                { label: "수신기", value: `${online}/${total}`, tone: online === total ? "ok" : "danger" },
                { label: "기준 비콘", value: status?.beacon_ok ? "정상" : "끊김", tone: status?.beacon_ok ? "ok" : "danger" },
              ],
            },
            {
              title: "신호",
              cells: [
                { label: "허용 목록", value: status?.allowlist.length ?? 0 },
                { label: "관찰 중", value: watching, tone: watching > 0 ? "warn" : undefined },
              ],
            },
            {
              title: "요청",
              cells: [
                { label: "수색 요청", value: open.length, tone: open.length > 0 ? "danger" : undefined },
                { label: "처리 완료", value: closed.length },
              ],
            },
          ]}
        />

        <div className="border-t border-line p-3 medium:p-5">
          <SeatMap rows={session?.rows ?? 4} cols={session?.cols ?? 10} zones={zones} seats={seats} nodes={nodes} compact={phone} zoneMenu={phone ? undefined : zoneMenu} />
          {!phone && (
            <div className="mt-5 border-t border-line pt-4">
              <StateTimeline clock={clock} events={events} requests={requests} startLabel={start} />
            </div>
          )}
        </div>
      </section>

      {sheet != null && requestsMap[sheet] && <EvidenceSheet req={requestsMap[sheet]} open onOpenChange={(o) => !o && setSheet(null)} />}
      <Confirm open={allow != null} onOpenChange={(o) => !o && setAllow(null)} title="허용 목록에 추가할까요?" action="허용 목록에 추가" onConfirm={confirmAllow} busy={allowBusy}>
        <p className="font-semibold text-fg">{allow?.what}</p>
        <p className="mt-1">감독관 본인 폰이나 시험장 장비처럼 문제없는 기기일 때만 추가하세요. 추가하면 이번 시험 동안 이 기기는 더 확인하지 않습니다.</p>
      </Confirm>
    </div>
  )
}

type Cell = { label: string; value: string | number; tone?: Tone }

/** 상태별 카운터 (장비 · 신호 · 요청 묶음). 휴대폰은 묶음 제목 없이 3칸 격자 */
function Counters({ groups, compact = false }: { groups: { title: string; cells: Cell[] }[]; compact?: boolean }) {
  if (compact)
    return (
      <div className="grid grid-cols-3 gap-1 px-3 pt-3 pb-3">
        {groups.flatMap((g) => g.cells).map((c) => <CounterCell key={c.label} c={c} compact />)}
      </div>
    )
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-3 px-4 pt-3 pb-4 medium:px-5">
      {groups.map((g) => (
        <div key={g.title}>
          <div className="mb-1 text-[11px] font-semibold text-fg-3">{g.title}</div>
          <div className="flex gap-1">
            {g.cells.map((c) => <CounterCell key={c.label} c={c} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

function CounterCell({ c, compact = false }: { c: Cell; compact?: boolean }) {
  return (
    <div className={cn("rounded-md text-center", compact ? "px-1 py-1.5" : "min-w-[78px] px-3 py-2 medium:min-w-[88px]",
      c.tone === "danger" ? "bg-danger-soft" : c.tone === "warn" ? "bg-warn-soft" : "bg-surface")}>
      <div className="flex items-center justify-center gap-1 text-xs whitespace-nowrap text-fg-2">
        {c.tone && <Shape tone={c.tone} className="size-2.5" />}
        {c.label}
      </div>
      <div className={cn("num leading-tight font-bold", compact ? "text-[17px]" : "mt-0.5 text-[20px]",
        c.tone === "danger" ? "text-danger" : c.tone === "warn" ? "text-warn" : "text-fg")}>
        {c.value}
      </div>
    </div>
  )
}

/** 요청이 없을 때만 보이는 상태 한 장 (AirGuard 홈 상단 카드 · v10 '평소에는 이상 없음만') */
function StatusCard({ watching }: { watching: boolean }) {
  const Icon = watching ? Eye : ShieldCheck
  return (
    <div aria-live="polite" className={cn("flex items-center gap-3 rounded-md px-4 py-5 text-white", watching ? "bg-warn-fill" : "bg-ok")}>
      <Icon className="size-9 shrink-0" strokeWidth={2.2} />
      <div>
        <div className="text-[24px] leading-tight font-bold">{watching ? "관찰 중" : "이상 없음"}</div>
        <div className="text-[14px] opacity-95">{watching ? "할 일 없음 · 자동으로 더 확인하는 중" : "AI 감지 없음"}</div>
      </div>
    </div>
  )
}

/** 에이전트가 돌고 있다는 것만 (자세한 흐름은 관리 탭) */
function AgentPulse({ devices, clock, last }: { devices: TrackedDevice[]; clock: Clock | null; last: string | null }) {
  const live = clock?.state === "running" && !clock.paused
  const n = devices.length
  return (
    <Link to="/admin" title={n > 0 ? `신호 ${n}개 확인 중` : "새 신호 없음"}
      className="ml-auto flex items-center gap-2 rounded-md px-2 py-1 text-[13px] text-fg-3 hover:bg-subtle">
      <Pulse on={live} />
      <span className="font-semibold text-fg-2">{live ? "작동 중" : clock?.paused ? "일시 정지" : "대기"}</span>
      {last && <span className="num hidden medium:inline">{last.slice(0, 5)}</span>}
      <ChevronRight className="size-4 shrink-0" />
    </Link>
  )
}
