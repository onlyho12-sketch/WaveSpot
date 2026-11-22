// 순회 · 휴대형 접근 → 결과 입력 (휴대폰 = 목에 건 수신기와 연동한 감독관 폰, 태블릿도 같은 흐름)
// ① 순회 전: 순회 경로 설정 (구역 순서 + 좌석마다 머무는 시간) + 버튼 2개 (근거 보기 · 순회 시작)
// ② 순회 중: Apple 정밀 탐색. 휴대폰은 화면 전체를 씀. ESP32 휴대형은 방향을 모르므로 화살표 대신
//    원형 게이지(이번 순회 최고값 대비) + 3단계 색(멀다 회색 · 가까워짐 주황 · 가장 가까움 빨강) + 진동
// ③ 순회 후: 강하게 들린 순서로 좌석 목록 → 눌러서 고르고 아래 고정 버튼으로 결과 입력
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { ArrowLeft, Check, ChevronDown, ChevronRight, ChevronUp, FileText, Footprints, ScanSearch, Vibrate, VibrateOff, X } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { EvidenceSheet, PartChips, requestTitle, target, targetSub, useGo } from "@/components/monitor/RequestCard"
import { SeatMap, type SeatState, type ZoneMark } from "@/components/monitor/SeatMap"
import { Button } from "@/components/ui/button"
import { Panel, Shape } from "@/components/ui/status"
import { api, type HandheldStep, type SearchRequest } from "@/lib/api"
import { patchRequest, sendResult, useLive } from "@/lib/live"
import { useIsPhone } from "@/lib/useIsPhone"
import { clockOf, cn, DONE_LABEL, isOpen, zoneOfSeat } from "@/lib/utils"

const NEAR: Record<HandheldStep["level"], { label: string; bg: string; buzz: string; every: number }> = {
  far: { label: "멀다", bg: "bg-notice", buzz: "진동 없음", every: 0 },
  near: { label: "가까워짐", bg: "bg-warn-fill", buzz: "2초마다 진동", every: 2000 },
  nearest: { label: "가장 가까움", bg: "bg-danger", buzz: "0.3초마다 진동", every: 300 },
}

export function RoamIndex() {
  const requestsMap = useLive((s) => s.requests)
  const start = useLive((s) => s.status?.session?.exam_start_label ?? "09:00")
  const open = Object.values(requestsMap).filter(isOpen).sort((a, b) => b.id - a.id)
  return (
    <div className="mx-auto max-w-3xl">
      <Panel title="순회할 요청">
        {open.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Shape tone="ok" className="mx-auto size-5" />
            <p className="mt-3 font-semibold">순회할 요청 없음</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {open.map((r) => (
              <li key={r.id}>
                <Link to="/roam/$id" params={{ id: String(r.id) }} className="flex items-center gap-4 px-4 py-4 hover:bg-subtle">
                  <Shape tone={r.level >= 3 ? "danger" : "warn"} className="size-4" />
                  <div className="min-w-0 flex-1">
                    <div className="text-lg font-bold">{target(r)}</div>
                    <div className="num text-sm text-fg-3">{requestTitle(r)}, {clockOf(r.sim_time, start)}{r.state === "searching" ? ", 순회 중" : ""}</div>
                  </div>
                  <ChevronRight className="size-5 text-fg-3" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

export function Roam() {
  const { id } = useParams({ from: "/roam/$id" })
  const req = useLive((s) => s.requests[Number(id)])
  const hh = useLive((s) => s.handheld[Number(id)])
  const status = useLive((s) => s.status)
  const phone = useIsPhone()
  // 순회 중인데 휴대형 신호가 4초 넘게 안 오면 멈춘 것으로 보고 빠져나갈 길을 줌 (수신기 꺼짐 · 서버가 순회를 안 돌림)
  const waiting = req?.state === "searching" && !(hh?.step && !hh.done)
  const [stalled, setStalled] = useState(false)
  useEffect(() => {
    setStalled(false)
    if (!waiting) return
    const t = setTimeout(() => setStalled(true), 4000)
    return () => clearTimeout(t)
  }, [waiting])

  if (!req) return <p className="p-4 text-fg-2">불러오는 중…</p>
  const step = req.state === "searching" && !hh?.done ? hh?.step ?? null : null
  const medians = hh?.done?.seat_medians ?? req.walk?.seat_medians ?? null
  const best = hh?.done?.best_seat ?? req.suspect_seat ?? null
  const rows = status?.session?.rows ?? 4
  const cols = status?.session?.cols ?? 10

  const head = (
    <section className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-2.5 medium:px-3">
      <Link to="/" className="grid size-10 place-items-center rounded-md text-fg-2 hover:bg-fg/5" aria-label="감독 화면으로"><ArrowLeft className="size-5" /></Link>
      <div className="min-w-0">
        <div className={cn("text-fs13 font-semibold", req.level >= 3 ? "text-danger" : "text-warn")}>{isOpen(req) ? requestTitle(req) : DONE_LABEL[req.state]}</div>
        <h1 className="truncate text-lg leading-tight font-bold">{target(req)} <span className="text-fs15 font-normal text-fg-2">{targetSub(req)}</span></h1>
      </div>
    </section>
  )

  // ② 순회 중
  const stallNote = "휴대형 수신기 신호가 오지 않습니다. 수신기 전원을 확인하세요"
  if (req.state === "searching" && stalled && medians)
    return <Result req={req} head={head} medians={medians} best={best} rows={rows} cols={cols} phone={phone} notice={`${stallNote}. 직전 순회 결과로 입력할 수 있습니다.`} />
  if (req.state === "searching") {
    return (
      // 태블릿 · PC: 상단 바(3.5rem) · 본문 여백(2rem) · 아래 탭(태블릿 세로 4rem)을 뺀 높이를 모두 채움
      <div className="flex flex-col gap-3 medium:min-h-[calc(100dvh-3.5rem-2rem-4rem)] medium:gap-4 expanded:min-h-[calc(100dvh-3.5rem-2rem)]">
        {head}
        {step ? (
          <Precision step={step} fullscreen={phone} />
        ) : (
          <Panel bodyClass="px-6 py-16 text-center text-fg-2">
            {stalled ? <><p className="font-semibold text-danger">{stallNote}</p><Link to="/" className="mt-4 inline-block font-semibold text-brand">감독 화면으로</Link></> : "휴대형 수신기 연결 중…"}
          </Panel>
        )}
      </div>
    )
  }

  // ③ 순회 후 · 결과
  if (medians) return <Result req={req} head={head} medians={medians} best={best} rows={rows} cols={cols} phone={phone} />

  // ① 순회 전
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-3 medium:gap-4">
      {head}
      <PreWalk req={req} rows={rows} cols={cols} />
    </div>
  )
}

function zonesOf(req: SearchRequest): ZoneMark[] {
  const z: ZoneMark[] = [{ zone: req.zone, kind: "request", label: req.zone2 ? "1순위" : "수색 구역" }]
  if (req.zone2) z.push({ zone: req.zone2, kind: "candidate", label: "2순위" })
  return z
}

const DWELLS = [1, 2, 3, 5] as const

/**
 * ① 순회 전 · 순회 경로 설정 (대상 고르기 + 순서 + 주기)
 * 좌석 지도에서 구역을 눌러 넣고 빼기, 목록에서 순서 바꾸기, 좌석마다 머무는 시간 (v10 실험 기본 2초)
 */
function PreWalk({ req, rows, cols }: { req: SearchRequest; rows: number; cols: number }) {
  const [open, setOpen] = useState(false)
  const { act } = useGo(req)
  const navigate = useNavigate()
  const [route, setRoute] = useState<number[]>(() => [req.zone, ...(req.zone2 ? [req.zone2] : [])])
  const [dwell, setDwell] = useState<number>(2)
  const [busy, setBusy] = useState(false)
  const walks = act?.walk ?? false

  const toggle = (z: number) => setRoute((r) => (r.includes(z) ? r.filter((x) => x !== z) : [...r, z]))
  const move = (i: number, d: -1 | 1) =>
    setRoute((r) => {
      const n = [...r]
      const j = i + d
      if (j < 0 || j >= n.length) return r
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })
  const secs = route.length * 5 * 2 * dwell // 구역 5석 · 앞뒤 2회 통과
  const marks: ZoneMark[] = route.map((z, i) => ({ zone: z, kind: i === 0 ? "request" : "candidate", label: `${i + 1}번째` }))

  async function start() {
    setBusy(true)
    try {
      patchRequest(await api.startSearch(req.id, false, { zones: route, dwell }))
      navigate({ to: "/roam/$id", params: { id: String(req.id) } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Panel title="순회 경로" aside={walks && <span className="num">예상 {Math.floor(secs / 60)}분 {secs % 60}초</span>} bodyClass="p-3 medium:p-4">
        <SeatMap rows={rows} cols={cols} zones={walks ? marks : zonesOf(req)} compact legend={!walks} onSelect={walks ? (seat) => toggle(zoneOfSeat(seat)) : undefined} />
        {walks && (
          <>
            <p className="mt-2 text-fs13 text-fg-3">좌석을 누르면 그 구역을 경로에 넣거나 뺍니다.</p>
            <ol className="mt-3 divide-y divide-line rounded-md border border-line">
              {route.length === 0 && <li className="px-3 py-4 text-center text-sm text-fg-3">돌 구역을 하나 이상 고르세요.</li>}
              {route.map((z, i) => (
                <li key={z} className="flex h-12 items-center gap-2 pr-1 pl-3">
                  <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-fg text-xs font-bold text-surface">{i + 1}</span>
                  <span className="font-semibold">{z}구역</span>
                  <span className="num text-sm text-fg-3">{(z - 1) * 5 + 1}~{z * 5}번</span>
                  {z === req.zone && <span className="text-xs font-semibold text-danger">AI 1순위</span>}
                  {z === req.zone2 && <span className="text-xs font-semibold text-warn">AI 2순위</span>}
                  <span className="ml-auto flex">
                    <IconBtn label="위로" disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp /></IconBtn>
                    <IconBtn label="아래로" disabled={i === route.length - 1} onClick={() => move(i, 1)}><ChevronDown /></IconBtn>
                    <IconBtn label="빼기" onClick={() => toggle(z)}><X /></IconBtn>
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-4">
              <div className="mb-1.5 text-fs13 font-semibold text-fg-2">좌석마다 머무는 시간</div>
              <div role="radiogroup" className="grid grid-cols-4 rounded-md border border-line-strong p-0.5">
                {DWELLS.map((d) => (
                  <button key={d} type="button" role="radio" aria-checked={dwell === d} onClick={() => setDwell(d)}
                    className={cn("num h-10 rounded-[5px] text-sm font-semibold", dwell === d ? "bg-fg text-surface" : "text-fg-2 hover:bg-fg/5")}>
                    {d}초{d === 2 ? " (권장)" : ""}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button variant="secondary" size="lg" onClick={() => setOpen(true)}><FileText />근거 보기</Button>
          {walks ? (
            <Button size="lg" onClick={start} disabled={busy || route.length === 0}><Footprints />순회 시작</Button>
          ) : (
            act && <Button size="lg" onClick={() => navigate({ to: "/roam/$id", params: { id: String(req.id) } })}><ScanSearch />{act.label}</Button>
          )}
        </div>
      </Panel>
      <EvidenceSheet req={req} open={open} onOpenChange={setOpen} />
    </>
  )
}

function IconBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      className="grid size-10 place-items-center rounded-md text-fg-2 hover:bg-fg/5 disabled:opacity-30 [&_svg]:size-[18px]">
      {children}
    </button>
  )
}

/** 단계에 맞춰 진동 (Android Chrome 지원 · iOS Safari 는 진동 API 없음) */
function useBuzz(every: number, on: boolean) {
  useEffect(() => {
    if (!on || !every || !("vibrate" in navigator)) return
    const pulse = () => navigator.vibrate(every <= 300 ? 120 : 250)
    pulse()
    const t = setInterval(pulse, every)
    return () => {
      clearInterval(t)
      navigator.vibrate(0)
    }
  }, [every, on])
}

/** ② 정밀 탐색 (Apple 나의 찾기 배치: 위 대상 · 가운데 표시 · 아래 큰 글자 2줄 · 둥근 버튼) */
function Precision({ step, fullscreen }: { step: HandheldStep; fullscreen: boolean }) {
  const navigate = useNavigate()
  const [buzz, setBuzz] = useState(true)
  const lv = NEAR[step.level]
  useBuzz(lv.every, buzz)
  const fill = Math.max(4, Math.min(100, 100 + step.rel_db * 6))
  const next = step.zones && step.zone_index != null ? step.zones[step.zone_index + 1] ?? null : null
  const R = 88, C = 2 * Math.PI * R

  return (
    <section aria-live="polite"
      className={cn("flex flex-col text-white transition-colors duration-300", lv.bg,
        fullscreen ? "fixed inset-0 z-50 px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]" : "min-h-[420px] flex-1 rounded-lg p-6")}>
      <div className="text-fs13 font-semibold tracking-wide opacity-70">
        순회 중{step.zones && step.zones.length > 1 ? `, ${step.zones.length}곳 중 ${(step.zone_index ?? 0) + 1}번째` : ""}, {step.pass}회차
      </div>
      <div className="mt-0.5 flex items-baseline gap-3">
        <span className="text-fs22 font-bold">지금 {step.zone}구역</span>
        {next != null && <span className="text-fs15 font-semibold opacity-75">다음 {next}구역</span>}
      </div>

      <div className="grid flex-1 place-items-center py-4">
        <div className="relative size-[min(68vw,240px)] expanded:size-[min(40dvh,340px)]">
          {/* 진동과 같은 박자로 바깥에 고리가 퍼짐 (진동을 꺼도 화면으로 알 수 있게). 0.3초 진동은 화면에선 너무 빨라 0.6초 */}
          {lv.every > 0 && (
            <span key={step.level} aria-hidden className="absolute inset-0 animate-roam-rip rounded-full border-[3px] border-white/75 opacity-0"
              style={{ animationDuration: `${Math.max(lv.every, 600)}ms` }} />
          )}
          <svg viewBox="0 0 200 200" className="relative size-full -rotate-90">
            <circle cx="100" cy="100" r={R} fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="12" />
            <circle cx="100" cy="100" r={R} fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C * (1 - fill / 100)} className="transition-[stroke-dashoffset] duration-300" />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="num text-fs34 leading-none font-bold">{step.rel_db === 0 ? "최고" : `${step.rel_db.toFixed(0)} dB`}</div>
              <div className="mt-1.5 text-fs13 opacity-75">이번 순회 최고값 대비</div>
            </div>
          </div>
        </div>
      </div>

      <div className="text-fs44 leading-none font-bold">{lv.label}</div>
      <div className="num mt-2 text-fs28 leading-tight font-semibold opacity-70">{step.pos_seat}번 옆</div>

      <div className="mt-6 flex items-center gap-4">
        <RoundButton label="닫기" onClick={() => navigate({ to: "/" })}><X className="size-6" /></RoundButton>
        <span className="flex-1 text-center text-sm opacity-80">{buzz ? lv.buzz : "진동 꺼짐"}, 좌석 옆 {step.dwell ?? 2}초</span>
        <RoundButton label={buzz ? "진동 끄기" : "진동 켜기"} onClick={() => setBuzz((b) => !b)}>
          {buzz ? <Vibrate className="size-6" /> : <VibrateOff className="size-6" />}
        </RoundButton>
      </div>
    </section>
  )
}

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="grid size-14 shrink-0 place-items-center rounded-full bg-white/20 active:bg-white/30">
      {children}
    </button>
  )
}

/** ③ 순회 후 · 좌석 고르기 + 결과 입력 */
function Result({ req, head, medians, best, rows, cols, phone, notice }: {
  req: SearchRequest; head: ReactNode; medians: Record<string, number>; best: number | null; rows: number; cols: number; phone: boolean; notice?: string
}) {
  const navigate = useNavigate()
  const [seat, setSeat] = useState<number | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const queued = useLive((s) => s.outbox.some((p) => p.id === req.id))
  const canResult = isOpen(req) && req.level >= 3 && !queued // searching(멈춤)도 isOpen
  const chosen = seat ?? best

  const list = useMemo(() => {
    const e = Object.entries(medians).map(([s, v]) => ({ seat: Number(s), v }))
    const lo = Math.min(...e.map((x) => x.v)), hi = Math.max(...e.map((x) => x.v))
    return e.sort((a, b) => b.v - a.v).map((x) => ({ ...x, w: hi > lo ? (x.v - lo) / (hi - lo) : 1 }))
  }, [medians])
  const shown = phone && !more ? list.slice(0, 5) : list

  async function submit(found: boolean) {
    setBusy(true)
    setErr(null)
    try {
      // 저장 확인이 없으면 태블릿에 먼저 저장하고 연결되면 자동 전송 (이중 저장)
      const { queued, req: r } = await sendResult(req.id, { found, seat: found ? chosen : null })
      if (r && !isOpen(r)) navigate({ to: "/" })
      if (!queued) setSeat(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const seats: Record<number, SeatState> = {}
  if (req.found_seat) seats[req.found_seat] = "found"
  else if (best) seats[best] = "suspect"

  async function rewalk() {
    setBusy(true)
    try {
      patchRequest(await api.startSearch(req.id, true))
    } finally {
      setBusy(false)
    }
  }

  const ranking = (
    <Panel title="신호가 강했던 순서" aside={isOpen(req) && (
      <button type="button" onClick={rewalk} disabled={busy} className="-mr-2 flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-semibold text-brand hover:bg-brand-soft disabled:opacity-40">
        <Footprints className="size-4" />다시 순회
      </button>
    )}>
      <ul className="divide-y divide-line">
        {shown.map((b, i) => (
          <li key={b.seat}>
            <button type="button" disabled={!canResult} onClick={() => setSeat(b.seat)} aria-pressed={canResult ? chosen === b.seat : undefined}
              className={cn("flex h-14 w-full items-center gap-3 px-4 text-left enabled:hover:bg-subtle", canResult && chosen === b.seat && "bg-fg/[0.06]")}>
              <span className={cn("num w-12 text-lg font-bold", b.seat === best && "text-danger")}>{b.seat}번</span>
              <span className="h-2 flex-1 overflow-hidden rounded-sm bg-subtle"><span className={cn("block h-full", i === 0 ? "bg-danger" : "bg-fg-3/50")} style={{ width: `${Math.max(4, b.w * 100)}%` }} /></span>
              <span className="w-10 text-right text-xs font-semibold text-danger">{i === 0 ? "최고" : ""}</span>
              {canResult && (
                <span className={cn("grid size-6 place-items-center rounded-full border-2", chosen === b.seat ? "border-fg bg-fg text-white" : "border-line-strong")}>
                  {chosen === b.seat && <Check className="size-3.5" strokeWidth={3} />}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {phone && list.length > 5 && (
        <button type="button" onClick={() => setMore((m) => !m)} className="h-11 w-full border-t border-line text-sm font-semibold text-brand">
          {more ? "접기" : `나머지 ${list.length - 5}석 보기`}
        </button>
      )}
    </Panel>
  )

  const actions = canResult && (
    <div className={cn("grid grid-cols-2 gap-2", phone && "fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface px-3 py-3")}>
      <Button variant="secondary" size="lg" onClick={() => submit(false)} disabled={busy}><X />미발견</Button>
      <Button variant="danger" size="lg" onClick={() => submit(true)} disabled={busy || chosen == null}><Check />{chosen ? `${chosen}번 발견` : "좌석 선택"}</Button>
    </div>
  )

  const side = (
    <Panel bodyClass="p-3 medium:p-4">
      <SeatMap rows={rows} cols={cols} zones={zonesOf(req)} seats={seats} compact
        selected={canResult ? chosen : null} onSelect={canResult ? setSeat : undefined} selectable={canResult ? list.map((b) => b.seat) : undefined} />
      <h3 className="mt-4 mb-2 text-fs13 font-semibold text-fg-3">{req.level === 4 ? "다시 볼 곳" : "금속탐지기로 볼 곳"}</h3>
      <PartChips parts={req.search_parts} />
      {!phone && <div className="mt-4 border-t border-line pt-4">{actions}</div>}
      {canResult && (
        <p className="mt-2 text-fs13 leading-snug text-fg-3">
          {req.level === 4
            ? "2차에서도 못 찾았는데 신호가 계속되면 '미해결'로 기록되고 시험 후 사람이 검토합니다."
            : "못 찾았는데 신호가 계속 잡히면 2차 수색(소지품, 책상, 다른 부위)을 요청하고, 이 결과는 학습에 쓰지 않습니다."}
        </p>
      )}
      {err && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{err}</p>}
      {queued && (
        <p role="status" className="mt-4 rounded-md bg-warn-soft px-3 py-2.5 text-sm font-semibold text-warn">
          전송 대기. 서버가 저장을 확인하지 않아 태블릿에 먼저 저장했습니다. 연결되면 자동으로 보냅니다.
        </p>
      )}
      {!isOpen(req) && <p className="mt-4 text-sm text-fg-2">입력 완료: {DONE_LABEL[req.state]}{req.found_seat ? ` (${req.found_seat}번)` : ""}</p>}
      {isOpen(req) && !canResult && !queued && <p className="mt-4 text-sm text-fg-2">정밀 수색 요청이 오면 결과를 입력합니다.</p>}
    </Panel>
  )

  return (
    <div className={cn("flex flex-col gap-3 medium:gap-4", phone && canResult && "pb-20")}>
      {head}
      {notice && <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm font-semibold text-danger">{notice}</div>}
      <div className="grid gap-3 medium:gap-4 expanded:grid-cols-2">
        {ranking}
        {side}
      </div>
      {phone && actions}
    </div>
  )
}
