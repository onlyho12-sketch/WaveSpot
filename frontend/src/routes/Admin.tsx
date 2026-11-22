// 관리 · 에이전트가 실제로 어떻게 돌아가는지 (심사 · 관리자용, 감독관 화면에는 넣지 않음)
// 탭 4개 · 처음 보는 사람은 '개요'만 봐도 되게 (숫자 · 그래프 위주, 설명 글은 각 탭 안으로)
// - 개요(시험장 관리자 기준): 상태 카드 6개(운영 상태 · 수색 요청 · 요청 대응 시간 · 확인 중인 신호 · 장애 · 공격 탐지) → 누르면 해당 탭
//         수색 단계 · 판단 기록 추이 · 장비 · 최근 판단 · 반입 금지 의심 기기(위험 점수순)
// - 에이전트(심사용 근거 포함): AI 모델 호출 추이(에이전트 vs 모두 실행) · AI 모델 6개(부름 · 건너뜀) · 판단 흐름(Datadog Bits 가설 트리)
//         · AI 판단 기록 · 지금 확인 중인 반입 금지 의심 기기(Kismet) · 대응 단계(설계안 '수색 강화 사다리')
// - 장애 · 공격 (v11 10장): 장애 대응 표 + 재현(검증 실험 7) · 장애 · 복구 기록 · 우회 · 해킹 대응(실험 8)
// - 장비 · 보안: 장비 · 데이터 출처 · 보안 · 권한 · 기록 위변조 확인 · 접근 기록 · 개인정보 · 보관
// 역할(감독관 · 관리자 · 감사)은 장애 재현 · 접근 기록 권한에 필요 · 장비 및 보안 탭의 보안 및 권한 패널에서 바꿈
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronRight, Minus, RefreshCw } from "lucide-react"
import { useMemo, useState } from "react"
import { EventColumns, LadderBars, ModelCards } from "@/components/admin/charts"
import { durParts, faultSummary, Meter, Tile } from "@/components/admin/kpi"
import { FaultsTab, MODE, RoomEquipment, SecurityBoard, SelfCheckList } from "@/components/admin/ops"
import { AgentLog, ModelUse } from "@/components/monitor/AgentLog"
import { ChainPanel } from "@/components/monitor/SystemPanels"
import { Button } from "@/components/ui/button"
import { Panel, Shape, Status, Tag } from "@/components/ui/status"
import { api, getRole, ROLE_NAME, setRole, type AgentEvent, type Role, type TrackedDevice } from "@/lib/api"
import { useLive } from "@/lib/live"
import { ALL_MODEL_KEYS, cn, isOpen, levelTone, MODEL_KEYS, NODE_PLACE, pct } from "@/lib/utils"

const MODELS: string[] = [...MODEL_KEYS] // 기기별 판단 단계
const ALL_MODELS: string[] = [...ALL_MODEL_KEYS] // 이상 감지 + 기기별
const STAGES = ["신호 감지", "위치 추정", "수색"] as const
const STATUS_NAME: Record<TrackedDevice["status"], string> = {
  observing: "확인 중", caution: "관찰 중", approach: "휴대형 접근", requested: "수색 요청", searching: "순회 중",
}

type Flow = {
  id: string
  last: AgentEvent
  ended: boolean
  stages: { name: string; ev: AgentEvent | null; n: number }[]
  calls: string[]
  skipped: string[]
  wait: { gain: number; loss: number } | null
}

function flows(events: AgentEvent[]): Flow[] {
  const by = new Map<string, AgentEvent[]>()
  for (const e of events) if (e.device_id && e.sim_time >= 0) by.set(e.device_id, [...(by.get(e.device_id) ?? []), e])
  return [...by.entries()]
    .map(([id, list]) => {
      const last = list[list.length - 1]
      const used = new Set(list.flatMap((e) => e.data?.calls ?? []))
      const w = [...list].reverse().find((e) => e.data?.gain != null)
      return {
        id,
        last,
        ended: /확인 끝|조사 종료/.test(last.message),
        stages: STAGES.map((s) => {
          const of = list.filter((e) => e.stage === s)
          return { name: s, ev: of.at(-1) ?? null, n: of.length }
        }),
        calls: MODELS.filter((m) => used.has(m)),
        skipped: MODELS.filter((m) => !used.has(m)),
        wait: w ? { gain: w.data!.gain!, loss: w.data!.loss! } : null,
      }
    })
    .sort((a, b) => b.last.sim_time - a.last.sim_time)
}

type Tab = "overview" | "agent" | "faults" | "system"
const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "개요" },
  { key: "agent", label: "AI 에이전트" },
  { key: "faults", label: "비상 대응" },
  { key: "system", label: "시스템" },
]
let lastTab: Tab = "overview" // 다른 화면에 다녀와도 보던 탭 유지

export function Admin() {
  const status = useLive((s) => s.status)
  const qc = useQueryClient()
  const [tab, setTabState] = useState<Tab>(lastTab)
  const [role, setR] = useState<Role>(getRole())
  const faultOn = (status?.health?.active.length ?? 0) > 0 || (status?.health?.mode ?? "normal") !== "normal"

  function setTab(t: Tab) {
    lastTab = t
    setTabState(t)
    window.scrollTo({ top: 0 })
  }
  function changeRole(r: Role) {
    setRole(r)
    setR(r)
    void qc.invalidateQueries()
  }

  return (
    <div className="flex flex-col gap-3 medium:gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="tablist" aria-label="관리 화면" className="flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-1">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
              className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3.5 text-sm font-semibold", tab === t.key ? "bg-fg text-white" : "text-fg-2 hover:bg-fg/5")}>
              {t.label}
              {t.key === "faults" && faultOn && <Shape tone="warn" className="size-2.5" />}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && <Overview onOpen={setTab} />}
      {tab === "agent" && <AgentTab />}
      {tab === "faults" && <FaultsTab />}
      {tab === "system" && <SystemTab role={role} onRole={changeRole} />}
    </div>
  )
}

function RoleSwitch({ role, onChange }: { role: Role; onChange: (r: Role) => void }) {
  return (
    <span className="flex items-center gap-2">
      역할
      <span role="radiogroup" aria-label="이 기기 역할" className="flex rounded-md border border-line-strong bg-surface p-0.5">
        {(Object.keys(ROLE_NAME) as Role[]).map((r) => (
          <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => onChange(r)}
            className={cn("h-7 rounded-[5px] px-2.5 text-fs13 font-semibold", role === r ? "bg-fg text-white" : "text-fg-2 hover:bg-fg/5")}>{ROLE_NAME[r]}</button>
        ))}
      </span>
    </span>
  )
}

/* ───────────── 개요 ───────────── */


function Overview({ onOpen }: { onOpen: (t: Tab) => void }) {
  const status = useLive((s) => s.status)
  const clock = useLive((s) => s.clock)
  const events = useLive((s) => s.events)
  const devices = useLive((s) => s.devices)
  const requests = useLive((s) => s.requests)
  const sessionId = status?.session?.id ?? null
  const start = status?.session?.exam_start_label ?? "09:00"
  const duration = status?.session?.duration_min ?? clock?.duration_min ?? 100
  const h = status?.health
  const nodes = status?.nodes ?? []

  // 다른 탭(장애 · 공격 · ChainPanel)과 같은 키 → 캐시를 함께 씀
  const equipN = events.filter((e) => e.stage === "장비").length
  const secN = events.filter((e) => e.stage === "보안").length
  const faults = useQuery({ queryKey: ["faults", sessionId, h?.active.length ?? 0, equipN], queryFn: api.faults, enabled: sessionId != null })
  const attacks = useQuery({ queryKey: ["attacks", sessionId, secN, Object.keys(requests).length, getRole()], queryFn: api.attacks, enabled: sessionId != null })
  const chain = useQuery({ queryKey: ["chain", sessionId], queryFn: api.verifyChain, enabled: sessionId != null })

  const mode = MODE[h?.mode ?? "normal"]
  const online = nodes.filter((n) => n.status === "online").length
  const reqs = Object.values(requests)
  const open = reqs.filter(isOpen).length
  // 요청 대응 시간: 요청이 뜬 뒤 감독관이 결과를 넣기까지 (결과 반영 기록 시각 - 요청 시각, 시험 시계 기준)
  const now = Math.max(clock?.t ?? 0, 0)
  const handled = reqs
    .filter((r) => !isOpen(r) && r.state !== "allowed")
    .flatMap((r) => {
      const t = events.find((e) => e.stage === "결과 반영" && e.device_id === r.device_id && e.sim_time >= r.sim_time)?.sim_time
      return t == null ? [] : [t - r.sim_time]
    })
  const avgHandle = handled.length ? handled.reduce((a, x) => a + x, 0) / handled.length : null
  const longestWait = open ? Math.max(...reqs.filter(isOpen).map((r) => now - r.sim_time), 0) : null
  const count = (s: string) => reqs.filter((r) => r.state === s).length
  const watch = devices.filter((d) => d.level === 1).length
  const hot = devices.filter((d) => d.level >= 2).length
  const recs = faults.data?.records ?? []
  const recovered = recs.filter((f) => f.ended != null)
  const runs = attacks.data?.runs ?? []
  const injected = runs.filter((r) => r.injected)
  const caught = injected.filter((r) => r.detected_at != null)
  const avgTook = caught.length ? Math.round(caught.reduce((a, r) => a + (r.took ?? 0), 0) / caught.length) : null
  const openAt = (lv: number) => reqs.filter((r) => isOpen(r) && r.level === lv).length
  const top = [...devices].sort((a, b) => b.score - a.score).slice(0, 5)

  return (
    // 넓은 화면: 상단 바(3.5rem) · 본문 여백(2rem) · 탭 줄(약 4rem)을 뺀 높이를 꽉 채움 (아래 두 줄이 나눠 가짐)
    <div className="flex flex-col gap-3 medium:gap-4 large:h-[calc(100dvh-9.5rem)] large:min-h-[600px]">
      {/* 상태 카드: 누르면 자세한 탭으로 */}
      <div className="grid grid-cols-2 gap-3 medium:grid-cols-3 medium:gap-4 large:grid-cols-6">
        <Tile label="운영 상태" tone={mode.tone} value={mode.short} small
          sub={`수신기 ${online}/${nodes.length || 4}, 비콘 ${h?.beacon === "frozen" ? "보정 정지" : status?.beacon_ok ? "정상" : "끊김"}`} onOpen={() => onOpen("system")}>
          <div className="flex gap-1">
            {nodes.map((n) => (
              <span key={n.node_id} className={cn("num grid h-6 flex-1 place-items-center rounded text-fs11 font-bold",
                n.status === "online" ? "bg-fg/[0.06] text-fg-2" : "border border-dashed border-danger bg-danger-soft text-danger")}>{n.node_id}</span>
            ))}
          </div>
        </Tile>
        <Tile label="수색 요청" tone={open > 0 ? "danger" : "ok"} value={String(open)} unit="건"
          sub={`완료 ${reqs.length - open}, 발견 ${count("found")}`} onOpen={() => onOpen("agent")}>
          <Meter parts={[{ v: openAt(2), cls: "bg-warn-fill" }, { v: openAt(3) + openAt(4), cls: "bg-danger" }, { v: reqs.length - open, cls: "bg-fg-3/45" }]} total={reqs.length} />
        </Tile>
        {/* 대기 중인 요청이 있으면 가장 오래 기다린 시간, 없으면 처리한 요청의 평균 */}
        <Tile label="요청 대응 시간" tone={longestWait != null ? "warn" : "ok"}
          {...durParts(longestWait ?? avgHandle)}
          sub={longestWait != null ? "가장 오래 기다린 요청" : avgHandle != null ? `처리 ${handled.length}건 평균` : "처리한 요청 없음"}
          onOpen={() => onOpen("agent")} />
        <Tile label="확인 중인 신호" tone={hot > 0 ? "danger" : watch > 0 ? "warn" : "ok"} value={String(devices.length)} unit="대"
          sub={`관찰 ${watch}, 요청 ${hot}`} onOpen={() => onOpen("agent")}>
          <Meter parts={[{ v: watch, cls: "bg-warn-fill" }, { v: hot, cls: "bg-danger" }]} total={devices.length} />
        </Tile>
        <Tile label="장애 및 복구" tone={faultSummary(h?.active, recs).tone} value={String(recs.length)} unit="건"
          sub={faultSummary(h?.active, recs).sub} onOpen={() => onOpen("faults")}>
          <Meter parts={[{ v: recovered.length, cls: "bg-fg-3/45" }, { v: recs.length - recovered.length, cls: "bg-warn-fill" }]} total={recs.length} />
        </Tile>
        <Tile label="모의 공격 탐지" tone={injected.length && caught.length < injected.length ? "warn" : "ok"}
          value={injected.length ? `${caught.length}/${injected.length}` : "0"} unit={injected.length ? undefined : "건"}
          sub={avgTook != null ? `평균 ${avgTook}초 만에 탐지` : `실제 탐지 ${runs.length - injected.length}건`} onOpen={() => onOpen("faults")}>
          <Meter parts={[{ v: caught.length, cls: "bg-fg-3/45" }, { v: injected.length - caught.length, cls: "bg-warn-fill" }]} total={injected.length} />
        </Tile>
      </div>

      <div className="grid grid-cols-1 gap-3 medium:gap-4 expanded:grid-cols-2 large:min-h-0 large:flex-[7] large:grid-cols-3 large:grid-rows-[minmax(0,1fr)]">
        <Panel title="에이전트 경보 단계" aside={<More onClick={() => onOpen("agent")} />} className="flex flex-col large:min-h-0" bodyClass="flex-1 px-5 py-2.5 large:min-h-0">
          <LadderBars
            now={[
              { tag: "Lv1", label: "추가 관찰", n: watch, tone: "warn" },
              { tag: "Lv2", label: "휴대형 접근", n: openAt(2), tone: "warn" },
              { tag: "Lv3", label: "정밀 수색", n: openAt(3), tone: "danger" },
              { tag: "Lv4", label: "2차 수색", n: openAt(4), tone: "danger" },
            ]}
            results={[
              { label: "발견", n: count("found"), tone: "neutral" },
              { label: "미발견", n: count("not_found"), tone: "neutral" },
              { label: "미해결", n: count("unresolved"), tone: "danger" },
            ]}
          />
        </Panel>
        <Panel title="AI 에이전트 판단 기록" aside={<span className="num">{events.filter((e) => e.sim_time >= 0).length}건</span>} className="flex flex-col large:min-h-0" bodyClass="flex-1 px-4 py-3 large:min-h-0">
          <EventColumns events={events} duration={duration} start={start} />
        </Panel>
        <Panel title="장비" aside={<More onClick={() => onOpen("system")} />} className="flex flex-col expanded:col-span-2 large:col-span-1 large:min-h-0" bodyClass="flex-1 large:min-h-0">
          <ul className="flex h-full flex-col divide-y divide-line text-fs16">
            {nodes.map((n) => (
              <li key={n.node_id} className="flex min-h-8 flex-1 items-center gap-3 px-4 py-1.5">
                <Status tone={n.status === "online" ? "ok" : "off"}><span className="font-semibold">수신기 {n.node_id}</span></Status>
                <span className="text-fg-3">{NODE_PLACE[n.node_id]}</span>
                <span className={cn("num ml-auto", n.status === "online" ? "text-fg-2" : "font-semibold text-danger")}>
                  {n.status !== "online" ? "응답 없음" : n.rate != null ? `${n.rate}건/초` : "정상"}
                </span>
              </li>
            ))}
            <li className="flex min-h-8 flex-1 items-center gap-3 px-4 py-1.5">
              <Status tone={h?.beacon === "frozen" ? "warn" : status?.beacon_ok ? "ok" : "off"}><span className="font-semibold">기준 비콘</span></Status>
              <span className="text-fg-3">교탁</span>
              <span className="ml-auto text-fg-2">{h?.beacon === "frozen" ? "보정 정지" : status?.beacon_ok ? "실시간 보정" : "끊김"}</span>
            </li>
            <li className="flex min-h-8 flex-1 items-center gap-3 px-4 py-1.5">
              <Status tone={!chain.data ? "neutral" : chain.data.ok ? "ok" : "danger"}><span className="font-semibold">기록 위변조</span></Status>
              <span className="num ml-auto text-fg-2">{!chain.data ? "확인 중" : chain.data.ok ? `고친 흔적 없음 (${chain.data.count.toLocaleString()}건)` : "기록이 바뀜"}</span>
            </li>
          </ul>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 medium:gap-4 expanded:grid-cols-2 large:min-h-0 large:flex-[4] large:grid-rows-[minmax(0,1fr)]">
        <Panel title="최근 AI 에이전트 판단" aside={<More onClick={() => onOpen("agent")} />} className="flex flex-col large:min-h-0" bodyClass="large:min-h-0 large:flex-1 large:overflow-y-auto">
          <AgentLog events={events} limit={5} dense big />
        </Panel>
        {/* '부정행위 기기'는 판정처럼 읽혀서 피함 (수색 전 · 결과 판단은 감독관) → '의심' + 정렬 기준 */}
        <Panel title={<>반입 금지 의심 기기<span className="ml-2 text-fs13 font-medium text-fg-3">위험 점수순</span></>} aside={<More onClick={() => onOpen("agent")} />} className="flex flex-col large:min-h-0" bodyClass="flex flex-1 flex-col large:min-h-0 large:overflow-y-auto">
          {top.length === 0 ? (
            <p className="m-auto px-4 py-8 text-center text-fs15 text-fg-3">확인 중인 신호 없음</p>
          ) : (
            <ul className="divide-y divide-line text-fs16">
              {top.map((d) => (
                <li key={d.device_id} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.75rem_5.5rem] items-center gap-3 px-4 py-3 large:grid-cols-[7.5rem_minmax(0,1fr)_4.5rem_8rem]">
                  <Status tone={levelTone(d.level)}><span className="text-fs15">{STATUS_NAME[d.status] ?? d.status}</span></Status>
                  <span className="truncate font-semibold">{d.kind}</span>
                  <span className="num text-fg-2">{d.zone == null ? "-" : `${d.zone}구역`}</span>
                  <ScoreMini score={d.score} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

const More =({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="flex items-center gap-0.5 text-fs13 font-semibold text-brand hover:underline">
    자세히<ChevronRight className="size-4" />
  </button>
)

/* ───────────── 에이전트 탭 ───────────── */

function AgentTab() {
  const status = useLive((s) => s.status)
  const clock = useLive((s) => s.clock)
  const events = useLive((s) => s.events)
  const devices = useLive((s) => s.devices)
  const requests = useLive((s) => s.requests)
  const list = useMemo(() => flows(events).slice(0, 6), [events])
  const st = useLive((s) => s.stats)
  const live = clock?.state === "running" && !clock.paused
  const allowed = status?.allowlist ?? []
  // 기기 이름: 추적 중 종류 → 요청의 종류 → 허용 목록 이름 (허용 기기는 종류를 따로 판단하지 않음)
  const kindOf = (id: string) => {
    const k = devices.find((d) => d.device_id === id)?.kind ?? Object.values(requests).find((r) => r.device_id === id)?.kind
    if (k) return k
    const a = allowed.find((x) => x.device_id === id)
    return a ? `허용 기기 (${a.label.split(", ")[0]})` : undefined
  }
  return (
    <>
      {/* 대응 단계: 에이전트가 고르는 다음 행동 (지금 단계별 몇 대) */}
      <LadderPanel />
      {/* 에이전트가 기기마다 어떤 모델을 불렀고 어느 단계에서 멈췄나 */}
      <div className="grid grid-cols-1 gap-3 medium:gap-4 large:grid-cols-2">
        <Panel title={<span className="flex items-center gap-2"><Pulse on={live} />반입 금지 의심 기기 판단 과정</span>} aside={<span className="num">최근 {list.length}대</span>}>
          {list.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-fg-3">아직 판단한 신호가 없습니다.</p>
          ) : (
            <>
            <p className="border-b border-line bg-subtle px-4 py-2 text-fs13 text-fg-2">
              에이전트가 기기마다 ① 신호 감지 → ② 위치 추정 → ③ 수색 요청 순서로 판단하고, 확인이 끝나면 다음 단계는 건너뜁니다.
            </p>
            <ul className="divide-y divide-line">
              {list.map((f) => <FlowRow key={f.id} f={f} kind={kindOf(f.id)} dev={devices.find((d) => d.device_id === f.id)} />)}
            </ul>
            </>
          )}
        </Panel>
        <Panel title="AI 모델 6개" aside={<span>기기마다 5개 + 교실 전체 1개 (이상 감지)</span>} bodyClass="p-3">
          <ModelCards models={ALL_MODELS} byModel={st?.by_model ?? {}} total={st?.device_windows ?? 0} totals={{ 이상: st?.windows ?? 0 }} />
        </Panel>
      </div>
      <Panel title={<span className="flex items-center gap-2"><Pulse on={live} />AI 에이전트 판단 기록</span>} aside={<ModelLegend />}>
        <div className="max-h-[520px] overflow-y-auto">
          <AgentLog events={events} showCalls />
        </div>
      </Panel>
      <DeviceTable devices={devices} allowlist={status?.allowlist ?? []} />
    </>
  )
}

/* ───────────── 장비 · 보안 탭 ───────────── */

function SystemTab({ role, onRole }: { role: Role; onRole: (r: Role) => void }) {
  const status = useLive((s) => s.status)
  const sessionId = status?.session?.id ?? null
  return (
    <>
      <div className="grid grid-cols-1 gap-3 medium:gap-4 large:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="장비 배치" bodyClass="p-4"
          aside={status?.health?.checkpoint ? <span className="num">마지막 상태 저장 {status.health.checkpoint}</span> : undefined}>
          <RoomEquipment status={status} />
        </Panel>
        <Panel title="시험 전 자가 점검">
          <SelfCheckList status={status} />
        </Panel>
      </div>
      <SecurityBoard status={status} role={role} aside={<RoleSwitch role={role} onChange={onRole} />} />
      <ChainPanel sessionId={sessionId} />
      <AccessPanel />
    </>
  )
}

/** 대응 단계 이름 (기기별 판단 과정 꼬리표와 같은 이름) */
const LV_NAME = ["감시", "추가 관찰", "휴대형 접근", "정밀 수색", "2차 수색"]

/** 대응 단계 (설계안 '수색 강화 사다리') · 핵심만: 언제 올라가나 / 감독관 할 일 / 지금 몇 대 */
const LADDER: { lv: number; tone: "ok" | "warn" | "danger"; when: string; todo: string }[] = [
  { lv: 0, tone: "ok", when: "허용 목록 밖 신호 없음", todo: "없음" },
  { lv: 1, tone: "warn", when: "위험 40~69점", todo: "없음 (에이전트가 30초 더 지켜봄)" },
  { lv: 2, tone: "warn", when: "60점 이상 + 구역 확신, 또는 영상 통화나 사진 전송", todo: "휴대형 수신기로 구역 순회" },
  { lv: 3, tone: "danger", when: "70점 이상 30초 연속 + 근거 2개 이상", todo: "의심 좌석을 금속탐지기로 수색" },
]
const LADDER_TOP: Record<string, string> = { ok: "border-t-line-strong", warn: "border-t-warn-fill", danger: "border-t-danger" }
const LADDER_TAG: Record<string, string> = { ok: "bg-fg-3", warn: "bg-warn-fill", danger: "bg-danger" }

function LadderPanel() {
  const devices = useLive((s) => s.devices)
  const requests = useLive((s) => s.requests)
  const now = useMemo(() => {
    const r = Object.values(requests).filter((x) => x.state === "open" || x.state === "searching")
    return [null, devices.filter((d) => d.level === 1).length, r.filter((x) => x.level === 2).length, r.filter((x) => x.level >= 3).length]
  }, [devices, requests])
  return (
    <Panel title="에이전트 경보 단계">
      <ol className="grid grid-cols-1 gap-2 p-3 medium:grid-cols-2 medium:p-4 expanded:grid-cols-4">
        {LADDER.map((l) => (
          <li key={l.lv} className={cn("rounded-md border border-t-[3px] border-line px-3.5 py-2.5", LADDER_TOP[l.tone])}>
            <div className="flex items-center gap-2">
              <span className={cn("num rounded px-1.5 py-0.5 text-fs13 font-bold text-white", LADDER_TAG[l.tone])}>Lv{l.lv}</span>
              <span className="text-fs17 font-bold">{LV_NAME[l.lv]}</span>
              {now[l.lv] != null && <span className={cn("num ml-auto text-fs17 font-bold", now[l.lv]! > 0 ? "text-fg" : "text-fg-3")}>{now[l.lv]}<span className="text-fs13 font-semibold text-fg-3">대</span></span>}
            </div>
            <dl className="mt-2 grid grid-cols-[5.25rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-fs14 leading-snug">
              <dt className="font-semibold text-fg-3">판단 기준</dt>
              <dd>{l.when}</dd>
              <dt className="font-semibold text-fg-3">감독관 할 일</dt>
              <dd className={cn(l.lv >= 2 && "font-semibold")}>{l.todo}</dd>
            </dl>
          </li>
        ))}
      </ol>
    </Panel>
  )
}

/** 접근 기록 (관리자 · 감사만) · 자동 갱신하지 않음 (열람도 기록에 남으므로) */
function AccessPanel() {
  const q = useQuery({ queryKey: ["access", getRole()], queryFn: api.access, retry: false, refetchOnWindowFocus: false })
  const rows = q.data ?? []
  const denied = rows.filter((r) => !r.allowed).length
  const byRole = Object.entries(rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.role_name]: (a[r.role_name] ?? 0) + 1 }), {}))
  return (
    <Panel title="접근 기록" aside={
      <Button size="sm" variant="subtle" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className={cn(q.isFetching && "animate-spin")} />새로고침</Button>
    }>
      {q.isError ? (
        <p className="px-4 py-6 text-center text-sm text-fg-3">{(q.error as Error).message}. 위 '보안 및 권한'에서 역할을 관리자나 검토자로 바꾸세요.</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-fg-3">기록 없음</p>
      ) : (
        <>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line px-4 py-3 text-fs13">
          <span className="num"><b className="text-fs20">{rows.length}</b> 건 <span className="text-fg-3">(최근)</span></span>
          <Status tone="ok">허용 {rows.length - denied}</Status>
          <Status tone={denied ? "off" : "neutral"}><span className={cn(denied > 0 && "font-semibold text-danger")}>거부 {denied}</span></Status>
          <Meter className="w-36" total={rows.length} parts={[{ v: rows.length - denied, cls: "bg-fg-3/45" }, { v: denied, cls: "bg-danger" }]} />
          <span className="num ml-auto text-fg-3">{byRole.map(([k, v]) => `${k} ${v}`).join(", ")}</span>
        </div>
        <div className="max-h-[300px] overflow-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="sticky top-0 border-b border-line bg-subtle text-left text-xs text-fg-3">
              <tr>
                <th className="px-4 py-2 font-semibold">시각</th>
                <th className="py-2 font-semibold">역할</th>
                <th className="py-2 font-semibold">구분</th>
                <th className="py-2 font-semibold">대상</th>
                <th className="px-4 py-2 text-right font-semibold">결과</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className={cn(!r.allowed && "bg-danger-soft/50")}>
                  <td className="num px-4 py-2 text-fg-2">{new Date(r.at).toLocaleTimeString("ko-KR", { hour12: false })}</td>
                  <td className="py-2">{r.role_name}</td>
                  <td className="py-2">{r.action}</td>
                  <td className="num py-2 text-fs13 text-fg-2">{r.method} {r.path.replace(/^\/api/, "")}</td>
                  <td className="px-4 py-2 text-right">{r.allowed ? <Status tone="ok">허용</Status> : <Status tone="off"><span className="font-semibold text-danger">거부 {r.status}</span></Status>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </Panel>
  )
}

const FILTERS = [
  { key: "all", label: "전체", test: () => true },
  { key: "watch", label: "관찰 중", test: (d: TrackedDevice) => d.level === 1 },
  { key: "request", label: "수색 요청", test: (d: TrackedDevice) => d.level >= 2 },
  { key: "allow", label: "허용 목록", test: () => false },
] as const

/** 추적 중 기기 표 (Kismet 기기 목록) + 상태 필터 · 허용 목록 기기는 기본으로 빠짐 */
function DeviceTable({ devices, allowlist }: { devices: TrackedDevice[]; allowlist: { device_id: string; label: string }[] }) {
  const [f, setF] = useState<(typeof FILTERS)[number]["key"]>("all")
  const cur = FILTERS.find((x) => x.key === f)!
  const rows = devices.filter(cur.test)
  const count = (k: (typeof FILTERS)[number]) => (k.key === "allow" ? allowlist.length : devices.filter(k.test).length)
  return (
    <Panel title="지금 확인 중인 반입 금지 의심 기기" aside={<span className="hidden medium:inline">교실 안에서 잡힌 신호</span>}>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
        {FILTERS.map((x) => (
          <button key={x.key} role="tab" type="button" aria-selected={f === x.key} onClick={() => setF(x.key)}
            className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-fs13 font-semibold", f === x.key ? "bg-fg text-white" : "text-fg-2 hover:bg-fg/5")}>
            {x.label}<span className="num opacity-70">{count(x)}</span>
          </button>
        ))}
      </div>
      {f === "allow" ? (
        <ul className="divide-y divide-line text-sm">
          {allowlist.length === 0 && <li className="px-4 py-6 text-center text-fg-3">허용 목록이 비어 있습니다.</li>}
          {allowlist.map((a) => (
            <li key={a.device_id} className="flex items-center gap-3 px-4 py-2.5"><Status tone="ok">허용</Status>{a.label}<span className="num ml-auto text-xs text-fg-3">{a.device_id}</span></li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line bg-subtle text-left text-xs text-fg-3">
              <tr>
                <th className="px-4 py-2 font-semibold">상태</th>
                <th className="py-2 font-semibold">기기</th>
                <th className="py-2 font-semibold">종류 추정</th>
                <th className="w-44 py-2 font-semibold">위험 점수</th>
                <th className="py-2 font-semibold">추정 구역</th>
                <th className="px-4 py-2 font-semibold">다음 후보</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-fg-3">해당하는 기기 없음</td></tr>}
              {rows.map((d) => (
                <tr key={d.device_id}>
                  <td className="px-4 py-2.5"><Status tone={levelTone(d.level)}>{STATUS_NAME[d.status] ?? d.status}</Status></td>
                  <td className="num py-2.5 text-fg-2">{d.device_id}{d.hold && <Tag className="ml-2">기기 연결 보류</Tag>}</td>
                  <td className="py-2.5">{d.kind}</td>
                  <td className="py-2.5 pr-4"><ScoreMini score={d.score} /></td>
                  <td className="num py-2.5">{d.zone == null ? <span className="text-danger">위치 추정 중지</span> : <>{d.zone}구역 <span className="text-fg-3">{pct(d.zone_prob)}</span></>}</td>
                  <td className="num px-4 py-2.5 text-fg-2">{d.zone2 ? <>{d.zone2}구역 <span className="text-fg-3">{pct(d.zone2_prob)}</span></> : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function FlowRow({ f, kind, dev }: { f: Flow; kind?: string; dev?: TrackedDevice }) {
  const reached = f.stages.map((s) => s.n > 0)
  const lastIdx = reached.lastIndexOf(true)
  const ended = f.ended && !dev // 지금 추적 중이면 종료가 아님
  const tone = dev ? levelTone(dev.level) : "neutral"
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Shape tone={tone} />
        <span className="text-fs15 font-semibold">{kind ?? (/교실 밖/.test(f.last.message) ? "교실 밖 신호" : "종류 확인 전 기기")}</span>
        <span className="num text-xs text-fg-3">{f.id}</span>
        {dev && <Tag tone={levelTone(dev.level)}>Lv{dev.level} {LV_NAME[dev.level]}</Tag>}
        {dev && <span className="num text-fs13 text-fg-2">위험 {dev.score}점</span>}
        {ended && <Tag>확인 끝 (Lv0 감시)</Tag>}
        <span className="num ml-auto text-xs text-fg-3">{f.last.clock}</span>
      </div>

      {/* 판단 순서: 거친 단계 진하게, 멈춘 뒤 단계는 점선 · 흐리게 */}
      <ol className="mt-2.5 grid grid-cols-3 gap-0">
        {f.stages.map((s, i) => {
          const done = s.n > 0
          const current = i === lastIdx && !ended
          return (
            <li key={s.name} className="relative min-w-0 pr-3">
              {i < 2 && <span className={cn("absolute top-[13px] right-0 left-7 h-0.5", reached[i + 1] ? "bg-fg-2" : "border-t-2 border-dashed border-line-strong")} />}
              <span className={cn("relative z-10 grid size-7 place-items-center rounded-full border-2 text-xs font-bold",
                current ? "border-fg bg-surface text-fg" : done ? "border-fg-2 bg-fg-2 text-white" : "border-dashed border-line-strong bg-surface text-fg-3")}>
                {done && !current ? <Check className="size-3.5" strokeWidth={3} /> : !done ? <Minus className="size-3.5" /> : i + 1}
              </span>
              <div className={cn("mt-1 text-fs14 font-semibold", !done && "text-fg-3")}>{s.name}{s.n > 1 ? <span className="num ml-1 font-medium text-fg-3">{s.n}회</span> : null}</div>
              <div className={cn("line-clamp-2 text-fs13 leading-snug", done ? "text-fg-2" : "text-fg-3/70")}>
                {s.ev ? s.ev.message.replace(/\s*\([^)]*\)/g, "") : ended ? "필요 없어 건너뜀" : "아직 안 함"}
              </div>
            </li>
          )
        })}
      </ol>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <ModelUse calls={f.calls} />
        {f.wait && <WaitDecision gain={f.wait.gain} loss={f.wait.loss} />}
      </div>
    </li>
  )
}

/**
 * 더 지켜볼지 바로 움직일지 (에이전트 결정 함수): 30초 더 볼 때 얻는 확신 vs 그동안 놓칠 위험
 * 숫자 대신 막대 2개 + 결정 꼬리표 (숫자는 마우스를 올리면)
 */
function WaitDecision({ gain, loss }: { gain: number; loss: number }) {
  const look = gain > loss
  const max = Math.max(gain, loss, 0.01)
  const bar = (v: number, cls: string) => (
    <span className="h-1.5 w-12 overflow-hidden rounded-full bg-subtle"><span className={cn("block h-full rounded-full", cls)} style={{ width: `${(v / max) * 100}%` }} /></span>
  )
  return (
    <span className="flex items-center gap-2 text-xs text-fg-2" title={`30초 더 볼 때 얻는 확신 ${gain.toFixed(2)}, 그동안 놓칠 위험 ${loss.toFixed(2)}`}>
      <span className="flex items-center gap-1">더 볼 때 얻는 확신 {bar(gain, "bg-fg-2")}</span>
      <span className="flex items-center gap-1">놓칠 위험 {bar(loss, "bg-danger")}</span>
      <Tag tone={look ? "warn" : "danger"}>{look ? "→ Lv1 추가 관찰" : "→ Lv2 휴대형 접근"}</Tag>
    </span>
  )
}

/** 부름 · 건너뜀 범례 (AI 판단 기록 머리줄) */
function ModelLegend() {
  return (
    <span className="hidden items-center gap-3 text-xs medium:flex">
      <span className="flex items-center gap-1"><span className="size-2 rounded-[2px] bg-fg-2" />부른 AI 모델</span>
      <span className="flex items-center gap-1"><span className="size-2 rounded-[2px] border border-line-strong" />건너뜀</span>
    </span>
  )
}

function ScoreMini({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative h-2 flex-1 rounded-sm bg-subtle">
        <span className={cn("absolute inset-y-0 left-0 rounded-sm", score >= 70 ? "bg-danger" : score >= 40 ? "bg-warn-fill" : "bg-fg-3")} style={{ width: `${Math.min(100, score)}%` }} />
        <span className="absolute -inset-y-1 left-[70%] w-px bg-fg" />
      </span>
      <span className="num w-7 text-right font-semibold">{score}</span>
    </div>
  )
}

export function Pulse({ on }: { on: boolean }) {
  return (
    // 움직이는 효과 없이 점 하나: 작동 중 = 진한 회색 채움, 멈춤 = 빈 원
    <span className={cn("inline-flex size-2.5 shrink-0 rounded-full", on ? "bg-fg-2" : "border-[1.5px] border-fg-3")} />
  )
}
