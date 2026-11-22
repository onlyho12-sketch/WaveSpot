// 관리 화면 '장애 · 공격' · '장비 · 보안' 탭 (v11 10장)
// 표 대신 그림 위주: 요약 숫자 → 단계적 축소 단계 → 교시 타임라인 → 대응 카드(자세한 글은 접어 둠)
// 장비는 교실 배치도 위에 수신기 4대 · 기준 비콘, 보안 · 개인정보는 아이콘 칸
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BadgeCheck, Check, Clock, Cpu, EyeOff, Globe, KeyRound, Lock, Minus, Radio, Swords, X, Zap,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { SpanTimeline, type SpanRow } from "@/components/admin/charts"
import { dur, Meter, Tile } from "@/components/admin/kpi"
import { Button } from "@/components/ui/button"
import { Panel, Shape, Status, Tag } from "@/components/ui/status"
import { api, getRole, ROLE_NAME, type AttackSpec, type Role, type Status as LiveStatus } from "@/lib/api"
import { patchStatus, useLive } from "@/lib/live"
import { cn, type Tone } from "@/lib/utils"

/** 단계적 축소 단계 (v11 10장) */
export const MODE: Record<string, { label: string; short: string; tone: Tone; desc: string }> = {
  normal: { label: "정상", short: "정상", tone: "ok", desc: "수신기 4대와 AI 모델로 판단" },
  degraded: { label: "수신기 3대로 판단", short: "수신기 3대", tone: "warn", desc: "3대용 위치 모델 (범위를 넓게 표시)" },
  no_location: { label: "위치 추정 중지", short: "위치 추정 중지", tone: "danger", desc: "숨은 기기 여부만 판단하고 휴대형으로 순회" },
  manual: { label: "감시 중단", short: "감시 중단", tone: "danger", desc: "망 끊김. 수신기에 자체 저장하고 수동 감독" },
  recovering: { label: "복구 중", short: "복구 중", tone: "warn", desc: "서버 재시작 후 저장된 상태로 이어서 판단" },
}
const RING: Record<Tone, string> = {
  ok: "border-ok bg-ok-soft", warn: "border-warn-fill bg-warn-soft", danger: "border-danger bg-danger-soft",
  off: "border-danger bg-danger-soft", neutral: "border-line-strong bg-subtle", brand: "border-brand bg-brand-soft",
}
const LADDER_NAME = ["감시", "추가 관찰", "휴대형 접근", "정밀 수색", "2차 수색"]
/** "짧게 끊어 보내기 (기준 점수 바로 아래로 유지)" → 제목 · 괄호 속 보조 설명 */
const splitTitle = (t: string) => {
  const i = t.indexOf(" (")
  return i < 0 ? { main: t, sub: null } : { main: t.slice(0, i), sub: t.slice(i + 2).replace(/\)$/, "") }
}

/** 장애 · 공격 데이터 (개요 · 다른 패널과 같은 키 → 캐시 공유) */
function useOps() {
  const status = useLive((s) => s.status)
  const events = useLive((s) => s.events)
  const requests = useLive((s) => s.requests)
  const sessionId = status?.session?.id ?? null
  const equipN = events.filter((e) => e.stage === "장비").length
  const secN = events.filter((e) => e.stage === "보안").length
  const faults = useQuery({ queryKey: ["faults", sessionId, status?.health?.active.length ?? 0, equipN], queryFn: api.faults, enabled: sessionId != null })
  const attacks = useQuery({ queryKey: ["attacks", sessionId, secN, Object.keys(requests).length, getRole()], queryFn: api.attacks, enabled: sessionId != null })
  return { status, faults, attacks }
}

/* ───────────── 장애 · 공격 탭 ───────────── */

export function FaultsTab() {
  const { status, faults, attacks } = useOps()
  const clock = useLive((s) => s.clock)
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const h = status?.health
  const modeKey = h?.mode ?? "normal"
  const running = status?.session?.state === "running"
  const isAdmin = getRole() === "admin"
  const start = status?.session?.exam_start_label ?? "09:00"
  const duration = status?.session?.duration_min ?? clock?.duration_min ?? 100
  const now = Math.max(clock?.t ?? 0, 0)

  const recs = faults.data?.records ?? []
  const recovered = recs.filter((f) => f.ended != null)
  const avgRecover = recovered.length ? recovered.reduce((a, f) => a + (f.recover_sec ?? f.ended! - f.started), 0) / recovered.length : null
  const missed = recs.reduce((a, f) => a + (f.missed ?? 0), 0)
  const a = attacks.data
  const runs = a?.runs ?? []
  const injected = runs.filter((r) => r.injected)
  const caught = injected.filter((r) => r.detected_at != null)
  const avgTook = caught.length ? caught.reduce((s, r) => s + (r.took ?? 0), 0) / caught.length : null

  const activeKinds = new Set(h?.active.map((x) => x.kind) ?? [])
  if (modeKey === "degraded") activeKinds.add("node1")
  if (modeKey === "no_location") activeKinds.add("node2")
  const canFault = !!faults.data?.can_inject && running && isAdmin
  const canAttack = !!a?.can_inject && isAdmin
  const hintText = !isAdmin ? "모의 훈련은 관리자 역할만 (장비 및 보안 탭에서 바꿈)" : !running ? "모의 훈련은 시험 중에만" : null
  // 휴대폰은 제목이 꺾이지 않게 짧게
  const hint = hintText && (
    <span><span className="medium:hidden">{isAdmin ? "시험 중에만 훈련" : "관리자만 훈련"}</span><span className="hidden medium:inline">{hintText}</span></span>
  )

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    setErr(null)
    try {
      await fn()
      void qc.invalidateQueries({ queryKey: ["faults"] })
      void qc.invalidateQueries({ queryKey: ["attacks"] })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const rows: SpanRow[] = [
    ...recs.map((f) => ({
      key: `f${f.id}`, label: f.title, tag: f.injected ? "훈련" : undefined, start: f.started, end: f.ended, tone: "warn" as const,
      tip: `${f.clock.slice(0, 5)}${f.end_clock ? ` ~ ${f.end_clock.slice(0, 5)}` : " ~ 진행 중"}, ${f.action}${f.missed ? `, 놓친 측정값 ${f.missed}건` : ""}`,
    })),
    ...runs.map((r) => ({
      key: `a${r.id}`, label: splitTitle(r.title).main, tag: r.injected ? "훈련" : "실제", start: r.started, end: r.detected_at, mark: r.detected_at, tone: "danger" as const,
      tip: `${r.clock.slice(0, 5)} 시작, ${r.detected_at != null ? `${r.detected_clock?.slice(0, 5)} 탐지${r.took != null ? ` (${dur(r.took)})` : ""}` : "아직 탐지 안 됨"}${r.level != null ? `, 대응 Lv${r.level}` : ""}${r.detail ? `, ${r.detail}` : ""}`,
    })),
  ].sort((x, y) => x.start - y.start)

  const groups: { key: AttackSpec["group"]; title: string }[] = [
    { key: "evade", title: "① 절차를 아는 부정행위자의 회피" },
    { key: "hack", title: "② 시험 중 외부 조력자의 서버 해킹" },
  ]
  const cat = a?.catalog ?? []

  return (
    <>
      <div className="grid grid-cols-2 gap-3 medium:gap-4 large:grid-cols-4">
        <Tile label="장애 및 복구" tone={(h?.active.length ?? 0) > 0 ? "warn" : "ok"} value={String(recs.length)} unit="건"
          sub={(h?.active.length ?? 0) > 0 ? `지금 ${h!.active[0].title}` : avgRecover != null ? `${recovered.length}건 복구, 평균 ${dur(avgRecover)}` : "장애 없음"}>
          <Meter parts={[{ v: recovered.length, cls: "bg-ok", label: "복구" }, { v: recs.length - recovered.length, cls: "bg-warn-fill", label: "진행 중" }]} total={recs.length} />
        </Tile>
        <Tile label="놓친 측정값" tone={missed > 0 ? "warn" : "ok"} value={missed.toLocaleString()} unit="건"
          sub={missed > 0 ? "수신기에 저장 후 동기화해 사후 반영" : "실시간 판단에서 빠진 값 없음"} />
        <Tile label="모의 공격 탐지" tone={injected.length && caught.length < injected.length ? "warn" : "ok"}
          value={injected.length ? `${caught.length}/${injected.length}` : "0"} unit={injected.length ? undefined : "건"}
          sub={avgTook != null ? `평균 ${dur(avgTook)} 만에 탐지` : `훈련 없음, 실제 탐지 ${runs.length - injected.length}건`}>
          <Meter parts={[{ v: caught.length, cls: "bg-ok", label: "탐지" }, { v: injected.length - caught.length, cls: "bg-warn-fill", label: "미탐지" }]} total={injected.length} />
        </Tile>
        <Tile label="거부한 측정값" tone={(a?.rejected ?? 0) > 0 ? "warn" : "ok"} value={(a?.rejected ?? 0).toLocaleString()} unit="건"
          sub="등록 안 된 수신기나 불가능한 세기 조합" />
      </div>

      {err && <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-2.5 text-sm font-semibold text-danger">{err}</p>}

      <Panel title="장비 이상 때 동작 단계" bodyClass="p-4">
        <ol className="grid grid-cols-1 gap-2 medium:grid-cols-3 large:grid-cols-5">
          {Object.entries(MODE).map(([k, m], i) => {
            const cur = k === modeKey
            return (
              <li key={k} aria-current={cur ? "step" : undefined}
                className={cn("rounded-md border px-3 py-2.5", cur ? RING[m.tone] : "border-line bg-surface", !cur && "opacity-70")}>
                <div className="flex items-center gap-1.5 text-fs13 font-semibold">
                  {k !== "recovering" && <span className="num text-xs text-fg-3">{i + 1}</span>}
                  <Shape tone={m.tone} className="size-2.5" />
                  {m.label}
                  {cur && <Tag tone="brand" solid className="ml-auto h-5">지금</Tag>}
                </div>
                <div className="mt-0.5 text-xs text-fg-2">{m.desc}</div>
              </li>
            )
          })}
        </ol>
      </Panel>

      <Panel title="타임라인" bodyClass="px-4 py-3"
        aside={
          <span className="flex flex-wrap items-center gap-3 text-xs text-fg-2">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[3px] bg-warn-fill" />장애 ~ 복구</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[3px] bg-danger" />공격 ~ 탐지</span>
            <span className="flex items-center gap-1.5"><svg viewBox="0 0 12 12" className="size-3"><path d="M6 .6 11.4 6 6 11.4.6 6Z" fill="var(--color-fg)" /></svg>탐지</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-brand/60" />지금</span>
          </span>
        }>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-3">장애와 공격 없음. 시험 내내 정상</p>
        ) : (
          <SpanTimeline rows={rows} duration={duration} start={start} now={now} />
        )}
      </Panel>

      {/* 실험 8 결과: 최고 대응 단계 · 내용은 타임라인 막대로는 안 보여서 표로 (태블릿은 마우스 올리기가 없음) */}
      {runs.length > 0 && (
        <Panel title={<>공격 탐지 기록 <span className="num font-medium text-fg-3">{runs.length}</span></>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line bg-subtle text-left text-xs text-fg-3">
                <tr>
                  <th className="w-20 px-4 py-2 font-semibold">시각</th>
                  <th className="py-2 font-semibold">공격</th>
                  <th className="w-44 py-2 font-semibold">탐지</th>
                  <th className="w-32 py-2 font-semibold">최고 경보 단계</th>
                  <th className="px-4 py-2 font-semibold">내용</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...runs].sort((x, y) => y.started - x.started).map((r) => (
                  <tr key={r.id} className={cn(r.injected && r.detected_at == null && "bg-warn-soft/50")}>
                    <td className="num px-4 py-2.5 text-fg-2">{r.clock.slice(0, 5)}</td>
                    <td className="py-2.5">
                      <span className="font-semibold">{splitTitle(r.title).main}</span>
                      <Tag className="ml-2" tone={r.injected ? "neutral" : "danger"}>{r.injected ? "모의 훈련" : "실제 탐지"}</Tag>
                    </td>
                    <td className="py-2.5">
                      {r.detected_at != null ? (
                        <Status tone="ok"><span className="num">{r.detected_clock?.slice(0, 5)}{r.injected && r.took != null ? `, ${dur(r.took)} 만에` : ""}</span></Status>
                      ) : (
                        <Status tone="warn"><span className="font-semibold text-warn">아직 탐지 안 됨</span></Status>
                      )}
                    </td>
                    <td className="py-2.5">
                      {r.level != null ? <Tag tone={r.level >= 3 ? "danger" : r.level >= 1 ? "warn" : "neutral"}>Lv{r.level} {LADDER_NAME[r.level]}</Tag> : <span className="text-fg-3">-</span>}
                    </td>
                    <td className="px-4 py-2.5 text-fs13 text-fg-2">{r.detail ?? (r.kind === "approach_off" ? "요청이 나오면 휴대형 순회가 자동으로 시작됩니다" : "-")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="장애 대응" aside={hint} bodyClass="p-4">
        <ul className="grid grid-cols-1 gap-3 expanded:grid-cols-2 large:grid-cols-3">
          {(faults.data?.catalog ?? []).map((c) => {
            const on = activeKinds.has(c.kind)
            const n = recs.filter((r) => r.kind === c.kind).length
            return (
              <li key={c.kind} className={cn("flex flex-col rounded-lg border p-4", on ? "border-warn-fill bg-warn-soft/50" : "border-line bg-surface")}>
                <div className="flex items-center gap-2">
                  <Status tone={on ? "warn" : "ok"}><span className="text-fs17 font-semibold text-fg">{c.title}</span></Status>
                  {on ? <Tag tone="warn" className="ml-auto">진행 중</Tag> : n > 0 && <Tag className="ml-auto">{n}회</Tag>}
                </div>
                <div className="mt-2.5 rounded-md bg-subtle px-3 py-2.5 text-fs15">
                  <div className="text-fs13 font-semibold text-fg-3">감독관 화면</div>
                  <div className="mt-0.5 leading-snug">{c.screen === "-" ? "표시 없음 (자동 처리)" : c.screen}</div>
                </div>
                <Fold label="감지 및 자동 대응" big>
                  <Def k="감지">{c.detect}</Def>
                  <Def k="자동 대응">{c.action}</Def>
                </Fold>
                <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-2.5 pt-3">
                  <span className="flex items-start gap-1.5 text-fs14 leading-snug text-fg-2"><Clock className="mt-0.5 size-4 shrink-0" /><span>복구 목표 {c.target}</span></span>
                  {faults.data?.can_inject && (
                    <Button variant="secondary" className="ml-auto shrink-0" disabled={!canFault || on || busy != null}
                      onClick={() => run(c.kind, async () => patchStatus(await api.inject(c.kind)))}>
                      <Zap />{on ? "진행 중" : "훈련 시작"}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </Panel>

      <Panel title="우회 및 해킹 대응" aside={hint}>
        <div className="border-b border-line p-4">
          <dl className="grid grid-cols-1 gap-2 text-fs16 medium:grid-cols-2">
            <div className="rounded-md bg-subtle px-4 py-2.5">
              <dt className="text-fs13 font-semibold text-fg-3">이번 시험 기준 점수</dt>
              <dd className="num mt-0.5 font-semibold">{a?.thresholds ? `수색 ${a.thresholds.request}, 관찰 ${a.thresholds.caution}점` : "비공개 (관리자만)"}</dd>
            </div>
            <div className="rounded-md bg-subtle px-4 py-2.5">
              <dt className="text-fs13 font-semibold text-fg-3">허용 기기 입실 전 세기 패턴</dt>
              <dd className="num mt-0.5 font-semibold">{a?.fingerprints ?? 0}대 대조 중</dd>
            </div>
          </dl>
        </div>
        {groups.map((g) => (
          <section key={g.key} className="border-b border-line p-4 last:border-b-0">
            <h3 className="mb-3 text-fs15 font-semibold text-fg-2">{g.title}</h3>
            <ul className="grid grid-cols-1 gap-3 expanded:grid-cols-2 large:grid-cols-3">
              {cat.filter((c) => c.group === g.key).map((c) => {
                const t = splitTitle(c.title)
                const ran = injected.filter((r) => r.kind === c.kind)
                const got = ran.filter((r) => r.detected_at != null)
                const real = runs.filter((r) => !r.injected && r.kind === c.kind).length
                return (
                  <li key={c.kind} className="flex flex-col rounded-lg border border-line p-4">
                    <div className="min-w-0">
                      <div className="text-fs17 leading-snug font-semibold">{t.main}</div>
                      {t.sub && <div className="mt-1 text-fs14 leading-snug text-fg-3">{t.sub}</div>}
                    </div>
                    {(ran.length > 0 || real > 0) && (
                      <div className="num mt-2 flex flex-wrap gap-1.5 text-fs13">
                        {ran.length > 0 && <Tag tone={got.length === ran.length ? "ok" : "warn"}>훈련 {ran.length}회, 탐지 {got.length}회</Tag>}
                        {real > 0 && <Tag tone="danger">실제 탐지 {real}</Tag>}
                      </div>
                    )}
                    <Fold label="대응 및 남는 한계" big>
                      <Def k="대응">{c.response}</Def>
                      {c.limit && c.limit !== "-" && <Def k="한계">{c.limit}</Def>}
                    </Fold>
                    {c.replay && (
                      <Button variant="secondary" className="mt-auto self-start" disabled={!canAttack || busy != null}
                        onClick={() => run(c.kind, () => api.injectAttack(c.kind))}>
                        <Swords />{ran.length ? `다시 훈련 (${ran.length})` : "훈련 시작"}
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </Panel>
    </>
  )
}

/** 접어 둔 자세한 설명 */
function Fold({ label, children, big }: { label: string; children: ReactNode; big?: boolean }) {
  return (
    <details className={cn("group/f mt-2 mb-1", big ? "text-fs15" : "text-fs13")}>
      <summary className={cn("flex items-center gap-1 font-semibold text-fg-3 hover:text-fg", big ? "text-fs14" : "text-xs")}>
        <span className="inline-block transition-transform group-open/f:rotate-90">›</span>{label}
      </summary>
      <dl className="mt-1.5 space-y-1.5 text-fg-2">{children}</dl>
    </details>
  )
}
const Def = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 leading-snug">
    <dt className="font-semibold text-fg-3">{k}</dt>
    <dd>{children}</dd>
  </div>
)

/* ───────────── 장비 · 보안 탭 조각 ───────────── */

/** 교실 평면도: 칠판 · 교탁(기준 비콘) · 감독관석 · 출입문 · 좌석 40석(가운데 통로로 5석씩) · 네 모서리 천장 수신기 + 수신기 표 */
const NODE_IDS = ["R1", "R2", "R3", "R4"] as const
const NODE_AT: Record<string, string> = { R1: "앞 왼쪽", R2: "앞 오른쪽", R3: "뒤 왼쪽", R4: "뒤 오른쪽" }
const CORNER: Record<string, string> = { R1: "top-2 left-2", R2: "top-2 right-2", R3: "bottom-2 left-2", R4: "bottom-2 right-2" }

export function RoomEquipment({ status }: { status: LiveStatus | null }) {
  const nodes = status?.nodes ?? []
  const node = (id: string) => nodes.find((n) => n.node_id === id)
  const beacon = status?.health?.beacon === "frozen" ? { tone: "warn" as Tone, text: "보정 정지" } : status?.beacon_ok ? { tone: "ok" as Tone, text: "실시간 보정" } : { tone: "off" as Tone, text: "끊김" }
  const half = (from: number) => (
    <div className="grid flex-1 grid-cols-5 gap-x-1.5 gap-y-2.5">
      {Array.from({ length: 20 }, (_, i) => {
        const seat = from + Math.floor(i / 5) * 10 + (i % 5)
        return <span key={seat} className="num grid aspect-[5/4] place-items-center rounded-[4px] border border-line-strong bg-subtle text-fs11 text-fg-3">{seat}</span>
      })}
    </div>
  )
  return (
    <div className="space-y-4">
      <div className="relative mx-auto max-w-[680px] rounded-md border-[3px] border-fg-3/50 bg-surface px-[12%] pt-3 pb-[10%]">
        {/* 출입문: 왼쪽 벽 뒤쪽의 틈 */}
        <span aria-hidden className="absolute bottom-[14%] -left-[3px] h-[18%] w-[3px] bg-surface" />
        <span className="absolute bottom-[14%] left-1.5 grid h-[18%] place-items-center text-fs11 text-fg-3 [writing-mode:vertical-rl]">출입문</span>
        {/* 칠판 */}
        <div className="mx-auto h-2 w-[60%] rounded-sm bg-fg-2/70" />
        <div className="mt-0.5 text-center text-fs11 text-fg-3">칠판</div>
        {/* 교탁(기준 비콘) + 감독관석 */}
        <div className="relative mt-2 flex justify-center">
          <div className="rounded-md border border-line-strong bg-subtle px-3 py-1.5 text-center">
            <div className="text-fs11 font-semibold text-fg-3">교탁</div>
            <Status tone={beacon.tone} className="justify-center text-fs13"><span className="font-semibold">기준 비콘</span> <span className="text-fg-3">{beacon.text}</span></Status>
          </div>
          <span className="absolute top-1/2 right-0 hidden -translate-y-1/2 rounded border border-dashed border-line-strong px-2 py-1 text-fs11 text-fg-3 medium:block">감독관석</span>
        </div>
        {/* 좌석: 가운데 통로로 5석씩 (감독 화면의 반쪽 줄 구역과 같음) */}
        <div className="mt-5 flex gap-4">
          {half(1)}
          {half(6)}
        </div>
        {/* 천장 수신기 */}
        {NODE_IDS.map((id) => {
          const ok = node(id)?.status === "online"
          return (
            <span key={id} className={cn("absolute flex items-center gap-1 rounded-full border-[1.5px] px-2 py-0.5 text-fs13 font-bold", CORNER[id],
              ok ? "border-ok bg-ok-soft text-ok" : "border-dashed border-danger bg-danger-soft text-danger")}>
              {ok ? <Radio className="size-3.5" /> : <X className="size-3.5" strokeWidth={3} />}{id}
            </span>
          )
        })}
      </div>

      {/* 수신기 상태 */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-fs14">
          <thead className="border-b border-line text-left text-fs13 text-fg-3">
            <tr>
              <th className="py-2 pr-3 font-semibold">천장 수신기</th>
              <th className="py-2 pr-3 font-semibold">상태</th>
              <th className="py-2 pr-3 text-right font-semibold">받은 신호</th>
              <th className="py-2 pr-3 text-right font-semibold">들린 기기</th>
              <th className="py-2 pr-3 text-right font-semibold">시계 차</th>
              <th className="py-2 text-right font-semibold">마지막 수신</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {NODE_IDS.map((id) => {
              const n = node(id)
              const ok = n?.status === "online"
              return (
                <tr key={id}>
                  <td className="py-2 pr-3"><span className="font-semibold">{id}</span> <span className="text-fg-3">{NODE_AT[id]}</span></td>
                  <td className="py-2 pr-3">
                    <Status tone={ok ? "ok" : "off"}><span className={cn(!ok && "font-semibold text-danger")}>{ok ? "정상" : "응답 없음"}</span></Status>
                  </td>
                  <td className="num py-2 pr-3 text-right">{ok && n?.rate != null ? `${n.rate}건/초` : "-"}</td>
                  <td className="num py-2 pr-3 text-right">{ok ? `${n?.heard ?? "-"}대` : "-"}</td>
                  <td className={cn("num py-2 pr-3 text-right", (n?.skew_ms ?? 0) > 200 && "font-semibold text-danger")}>{ok && n?.skew_ms != null ? `${n.skew_ms}ms` : "-"}</td>
                  <td className="num py-2 text-right text-fg-2">{n?.last_seen ? n.last_seen.slice(11, 19) : "-"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** 시험 전 자가 점검 (v11) */
export function SelfCheckList({ status }: { status: LiveStatus | null }) {
  const items = status?.selfcheck ?? []
  const ok = items.filter((i) => i.ok).length
  return (
    <div>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="num text-fs22 leading-none font-bold">{ok}<span className="text-fs15 text-fg-3">/{items.length}</span></span>
        <span className="text-fs13 font-semibold text-fg-2">통과</span>
        <Meter className="ml-auto w-32" total={items.length} parts={[{ v: ok, cls: "bg-ok" }, { v: items.filter((i) => i.ok === false).length, cls: "bg-danger" }]} />
      </div>
      <ul className="divide-y divide-line text-sm">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-2.5 px-4 py-2.5">
            <span className={cn("grid size-5 shrink-0 place-items-center rounded-full", i.ok ? "bg-ok text-white" : i.ok === false ? "bg-danger text-white" : "bg-subtle text-fg-3")}>
              {i.ok ? <Check className="size-3" strokeWidth={3.5} /> : i.ok === false ? <X className="size-3" strokeWidth={3.5} /> : <Minus className="size-3" />}
            </span>
            <span className="font-semibold">{i.label}</span>
            <span className="num ml-auto truncate text-fs13 text-fg-2">{i.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const ROLE_DESC: Record<Role, string> = {
  supervisor: "교실에서 시험을 진행하는 사람. 감독, 순회, 수색 결과 입력",
  admin: "시험장 시스템과 장비 담당. 설정과 모의 훈련 (시험 중 기준값은 잠김)",
  auditor: "시험 후 이의 제기와 판정을 검토하는 제3자. 열람만 가능",
}

const PERMS: { what: string; roles: Record<Role, boolean> }[] = [
  { what: "감독, 순회, 결과 입력", roles: { supervisor: true, admin: true, auditor: false } },
  { what: "시험 준비와 시작", roles: { supervisor: true, admin: true, auditor: false } },
  { what: "모의 훈련과 설정", roles: { supervisor: false, admin: true, auditor: false } },
  { what: "리포트 열람과 내보내기", roles: { supervisor: true, admin: true, auditor: true } },
  { what: "접근 기록 열람", roles: { supervisor: false, admin: true, auditor: true } },
]

/** 보안: 아이콘 칸 6개 + 역할별 권한 */
export function SecurityBoard({ status, role, aside }: { status: LiveStatus | null; role: Role; aside?: ReactNode }) {
  const nodes = status?.nodes ?? []
  const cert = nodes.filter((n) => n.cert_ok).length
  const fw = nodes.filter((n) => n.fw_ok).length
  const locked = status?.health?.locked ?? false
  const total = nodes.length || 4
  const items: { icon: ReactNode; title: string; desc: string; tone: Tone }[] = [
    { icon: <Globe />, title: "외부 연결 없음", desc: "시험장 내부망에서만 동작", tone: "ok" },
    { icon: <BadgeCheck />, title: `수신기 인증서 ${cert}/${total}`, desc: "인증서 없는 수신기 데이터는 거부", tone: cert === total ? "ok" : "warn" },
    { icon: <Cpu />, title: `펌웨어 서명 ${fw}/${total}`, desc: "서명된 펌웨어만 설치", tone: fw === total ? "ok" : "warn" },
    { icon: <Lock />, title: locked ? "허용 목록 잠금" : "허용 목록 등록 중", desc: locked ? "시험 중 변경 시도는 거부로 기록" : "입실 전 기준선에서만 등록", tone: locked ? "ok" : "neutral" },
    { icon: <EyeOff />, title: "기준값 비공개", desc: "기준값, 가중치, 허용 목록, 해시 키", tone: "ok" },
    { icon: <KeyRound />, title: "관리자 2단계 인증", desc: "실기기 단계에서 적용 (지금은 역할 전환)", tone: "neutral" },
  ]
  return (
    <Panel title="보안 및 권한" aside={aside}>
      <div className="grid expanded:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] expanded:divide-x divide-line">
        <ul className="grid content-start grid-cols-1 gap-2 p-4 medium:grid-cols-2">
          {items.map((i) => (
            <li key={i.title} className="flex items-start gap-3 rounded-md border border-line px-3 py-2.5">
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-md [&_svg]:size-4",
                i.tone === "ok" ? "bg-ok-soft text-ok" : i.tone === "warn" ? "bg-warn-soft text-warn" : "bg-subtle text-fg-3")}>{i.icon}</span>
              <span className="min-w-0">
                <span className="block text-fs13 font-semibold">{i.title}</span>
                <span className="block text-xs leading-snug text-fg-3">{i.desc}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t border-line expanded:border-t-0">
          {/* 역할마다 누구인지 한 줄 + 나눈 이유 */}
          <ul className="divide-y divide-line border-b border-line">
            {(Object.keys(ROLE_NAME) as Role[]).map((r) => (
              <li key={r} className={cn("grid grid-cols-[4rem_minmax(0,1fr)] gap-2 px-4 py-2 text-fs14 leading-snug", r === role && "bg-brand-soft/50")}>
                <span className={cn("font-semibold", r === role && "text-brand")}>{ROLE_NAME[r]}</span>
                <span className="text-fg-2">{ROLE_DESC[r]}</span>
              </li>
            ))}
          </ul>
          <p className="border-b border-line bg-subtle px-4 py-2 text-fs13 leading-snug text-fg-2">
            판정 기록을 만드는 사람, 시스템을 바꾸는 사람, 기록을 확인하는 사람을 나눠 기록이 한쪽에 유리하게 바뀌었다는 의심을 막습니다.
          </p>
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-subtle text-xs text-fg-3">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">할 수 있는 일</th>
                {(Object.keys(ROLE_NAME) as Role[]).map((r) => <th key={r} className={cn("w-14 py-2 font-semibold", r === role && "text-brand")}>{ROLE_NAME[r]}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {PERMS.map((p) => (
                <tr key={p.what}>
                  <td className="px-4 py-2 text-fs13">{p.what}</td>
                  {(Object.keys(ROLE_NAME) as Role[]).map((r) => (
                    <td key={r} className={cn("py-2 text-center", r === role && "bg-brand-soft/50")}>
                      {p.roles[r] ? <Check className="mx-auto size-4 text-ok" strokeWidth={3} /> : <Minus className="mx-auto size-4 text-fg-3" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Panel>
  )
}

