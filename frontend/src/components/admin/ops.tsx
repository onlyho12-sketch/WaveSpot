// 관리 화면 '장애 · 공격' · '장비 · 보안' 탭 (v11 10장)
// 표 대신 그림 위주: 요약 숫자 → 단계적 축소 단계 → 교시 타임라인 → 대응 카드(자세한 글은 접어 둠)
// 장비는 교실 배치도 위에 수신기 4대 · 기준 비콘, 보안 · 개인정보는 아이콘 칸
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Armchair, BadgeCheck, Check, Clock, Cpu, EyeOff, FileSearch, Globe, Hash, KeyRound, Lock, Minus, Radio, Swords, Trash2, X, Zap,
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
  normal: { label: "정상", short: "정상", tone: "ok", desc: "수신기 4대 · AI 모델로 판단" },
  degraded: { label: "수신기 3대로 판단", short: "수신기 3대", tone: "warn", desc: "3대용 위치 모델 · 범위를 넓게 표시" },
  no_location: { label: "위치 추정 중지", short: "위치 추정 중지", tone: "danger", desc: "숨은 기기 여부만 판단 · 휴대형 순회" },
  manual: { label: "감시 중단", short: "감시 중단", tone: "danger", desc: "망 끊김 · 수신기 자체 저장 · 수동 감독" },
  recovering: { label: "복구 중", short: "복구 중", tone: "warn", desc: "서버 재시작 · 저장된 상태로 이어서 판단" },
}
const RING: Record<Tone, string> = {
  ok: "border-ok bg-ok-soft", warn: "border-warn-fill bg-warn-soft", danger: "border-danger bg-danger-soft",
  off: "border-danger bg-danger-soft", neutral: "border-line-strong bg-subtle", brand: "border-brand bg-brand-soft",
}
const ATTACK_STATE: Record<AttackSpec["status"], { label: string; tone: Tone; cls: string }> = {
  done: { label: "탐지 구현", tone: "ok", cls: "bg-ok" },
  shown: { label: "운영 절차", tone: "neutral", cls: "bg-fg-3/60" },
  todo: { label: "실기기 단계", tone: "warn", cls: "bg-warn-fill" },
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
  const hint = !isAdmin ? "재현은 관리자 역할만 · 오른쪽 위에서 바꿈" : !running ? "재현은 시험 중에만" : null

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
      key: `f${f.id}`, label: f.title, tag: f.injected ? "재현" : undefined, start: f.started, end: f.ended, tone: "warn" as const,
      tip: `${f.clock.slice(0, 5)}${f.end_clock ? ` ~ ${f.end_clock.slice(0, 5)}` : " ~ 진행 중"} · ${f.action}${f.missed ? ` · 놓친 측정값 ${f.missed}건` : ""}`,
    })),
    ...runs.map((r) => ({
      key: `a${r.id}`, label: splitTitle(r.title).main, tag: r.injected ? "재현" : "실제", start: r.started, end: r.detected_at, mark: r.detected_at, tone: "danger" as const,
      tip: `${r.clock.slice(0, 5)} 시작 · ${r.detected_at != null ? `${r.detected_clock?.slice(0, 5)} 탐지${r.took != null ? ` (${dur(r.took)})` : ""}` : "아직 탐지 안 됨"}${r.level != null ? ` · 대응 Lv${r.level}` : ""}${r.detail ? ` · ${r.detail}` : ""}`,
    })),
  ].sort((x, y) => x.start - y.start)

  const groups: { key: AttackSpec["group"]; title: string }[] = [
    { key: "evade", title: "① 절차를 아는 부정행위자의 회피" },
    { key: "hack", title: "② 시험 중 외부 조력자의 서버 해킹" },
  ]
  const cat = a?.catalog ?? []
  const byState = (s: AttackSpec["status"]) => cat.filter((c) => c.status === s).length

  return (
    <>
      <div className="grid grid-cols-2 gap-3 medium:gap-4 large:grid-cols-4">
        <Tile label="장애 · 복구" tone={(h?.active.length ?? 0) > 0 ? "warn" : "ok"} value={String(recs.length)} unit="건"
          sub={(h?.active.length ?? 0) > 0 ? `지금 ${h!.active[0].title}` : avgRecover != null ? `${recovered.length}건 복구 · 평균 ${dur(avgRecover)}` : "장애 없음"}>
          <Meter parts={[{ v: recovered.length, cls: "bg-ok", label: "복구" }, { v: recs.length - recovered.length, cls: "bg-warn-fill", label: "진행 중" }]} total={recs.length} />
        </Tile>
        <Tile label="놓친 측정값" tone={missed > 0 ? "warn" : "ok"} value={missed.toLocaleString()} unit="건"
          sub={missed > 0 ? "수신기에 저장 후 동기화 · 사후 반영" : "실시간 판단에서 빠진 값 없음"} />
        <Tile label="공격 재현 탐지" tone={injected.length && caught.length < injected.length ? "warn" : "ok"}
          value={injected.length ? `${caught.length}/${injected.length}` : "0"} unit={injected.length ? undefined : "건"}
          sub={avgTook != null ? `평균 ${dur(avgTook)} 만에 탐지` : `재현 없음 · 실제 탐지 ${runs.length - injected.length}건`}>
          <Meter parts={[{ v: caught.length, cls: "bg-ok", label: "탐지" }, { v: injected.length - caught.length, cls: "bg-warn-fill", label: "미탐지" }]} total={injected.length} />
        </Tile>
        <Tile label="거부한 측정값" tone={(a?.rejected ?? 0) > 0 ? "warn" : "ok"} value={(a?.rejected ?? 0).toLocaleString()} unit="건"
          sub="등록 안 된 수신기 · 불가능한 세기 조합" />
      </div>

      {err && <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-2.5 text-sm font-semibold text-danger">{err}</p>}

      <Panel title="장비 이상 때 동작 단계" aside={<span className="hidden medium:inline">장비가 멈춰도 낮은 단계로 물러나 감시를 이어감</span>} bodyClass="p-4">
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

      <Panel title="교시 타임라인" bodyClass="px-4 py-3"
        aside={
          <span className="flex flex-wrap items-center gap-3 text-xs text-fg-2">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[3px] bg-warn-fill" />장애 ~ 복구</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-[3px] bg-danger" />공격 ~ 탐지</span>
            <span className="flex items-center gap-1.5"><svg viewBox="0 0 12 12" className="size-3"><path d="M6 .6 11.4 6 6 11.4.6 6Z" fill="var(--color-fg)" /></svg>탐지</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-brand/60" />지금</span>
          </span>
        }>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-3">장애 · 공격 없음 · 교시 내내 정상</p>
        ) : (
          <SpanTimeline rows={rows} duration={duration} start={start} now={now} />
        )}
      </Panel>

      {/* 실험 8 결과: 최고 대응 단계 · 내용은 타임라인 막대로는 안 보여서 표로 (태블릿은 마우스 올리기가 없음) */}
      {runs.length > 0 && (
        <Panel title={<>공격 재현 · 탐지 기록 <span className="num font-medium text-fg-3">{runs.length}</span></>} aside={<span>검증 실험 8</span>}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line bg-subtle text-left text-xs text-fg-3">
                <tr>
                  <th className="w-20 px-4 py-2 font-semibold">시각</th>
                  <th className="py-2 font-semibold">공격</th>
                  <th className="w-44 py-2 font-semibold">탐지</th>
                  <th className="w-32 py-2 font-semibold">최고 대응 단계</th>
                  <th className="px-4 py-2 font-semibold">내용</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...runs].sort((x, y) => y.started - x.started).map((r) => (
                  <tr key={r.id} className={cn(r.injected && r.detected_at == null && "bg-warn-soft/50")}>
                    <td className="num px-4 py-2.5 text-fg-2">{r.clock.slice(0, 5)}</td>
                    <td className="py-2.5">
                      <span className="font-semibold">{splitTitle(r.title).main}</span>
                      <Tag className="ml-2" tone={r.injected ? "neutral" : "danger"}>{r.injected ? "재현" : "실제 탐지"}</Tag>
                    </td>
                    <td className="py-2.5">
                      {r.detected_at != null ? (
                        <Status tone="ok"><span className="num">{r.detected_clock?.slice(0, 5)}{r.injected && r.took != null ? ` · ${dur(r.took)} 만에` : ""}</span></Status>
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

      <Panel title="장애 대응" aside={<span>{hint ?? "재현 = 검증 실험 7 (복구 시간 · 놓친 측정값)"}</span>} bodyClass="p-4">
        <ul className="grid grid-cols-1 gap-3 expanded:grid-cols-2 large:grid-cols-3">
          {(faults.data?.catalog ?? []).map((c) => {
            const on = activeKinds.has(c.kind)
            const n = recs.filter((r) => r.kind === c.kind).length
            return (
              <li key={c.kind} className={cn("flex flex-col rounded-lg border p-3.5", on ? "border-warn-fill bg-warn-soft/50" : "border-line bg-surface")}>
                <div className="flex items-center gap-2">
                  <Status tone={on ? "warn" : "ok"}><span className="font-semibold text-fg">{c.title}</span></Status>
                  {on ? <Tag tone="warn" className="ml-auto">진행 중</Tag> : n > 0 && <Tag className="ml-auto">{n}회</Tag>}
                </div>
                <div className="mt-2 rounded-md bg-subtle px-2.5 py-2 text-fs13">
                  <div className="text-fs11 font-semibold text-fg-3">감독관 화면</div>
                  <div className="mt-0.5 leading-snug">{c.screen === "-" ? "표시 없음 · 자동 처리" : c.screen}</div>
                </div>
                <Fold label="감지 · 자동 대응">
                  <Def k="감지">{c.detect}</Def>
                  <Def k="자동 대응">{c.action}</Def>
                </Fold>
                <div className="mt-auto flex items-center gap-2 pt-3">
                  <span className="flex min-w-0 items-center gap-1 text-xs text-fg-2"><Clock className="size-3.5 shrink-0" /><span className="truncate">복구 목표 {c.target}</span></span>
                  {faults.data?.can_inject && (
                    <Button size="sm" variant="secondary" className="ml-auto shrink-0" disabled={!canFault || on || busy != null}
                      onClick={() => run(c.kind, async () => patchStatus(await api.inject(c.kind)))}>
                      <Zap />{on ? "진행 중" : "재현"}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </Panel>

      <Panel title="우회 · 해킹 대응" aside={<span>{hint ?? "방법은 공개돼도 기준값 · 허용 목록 · 키는 비공개"}</span>}>
        {/* 대응 범위: 15개 중 구현 상태 */}
        <div className="grid gap-4 border-b border-line p-4 expanded:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="num text-fs26 leading-none font-bold">{byState("done")}<span className="text-fs15 font-semibold text-fg-3">/{cat.length}</span></span>
              <span className="text-fs13 font-semibold text-fg-2">탐지 구현</span>
            </div>
            <Meter className="mt-3 h-2.5" total={cat.length}
              parts={(["done", "shown", "todo"] as const).map((s) => ({ v: byState(s), cls: ATTACK_STATE[s].cls, label: ATTACK_STATE[s].label }))} />
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
              {(["done", "shown", "todo"] as const).map((s) => (
                <span key={s} className="flex items-center gap-1.5"><span className={cn("size-2.5 rounded-sm", ATTACK_STATE[s].cls)} />{ATTACK_STATE[s].label} {byState(s)}</span>
              ))}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-fs13">
            <div className="rounded-md bg-subtle px-3 py-2">
              <dt className="text-fs11 font-semibold text-fg-3">이번 교시 기준 점수</dt>
              <dd className="num mt-0.5 font-semibold">{a?.thresholds ? `수색 ${a.thresholds.request} · 관찰 ${a.thresholds.caution}점` : "비공개 · 관리자만"}</dd>
            </div>
            <div className="rounded-md bg-subtle px-3 py-2">
              <dt className="text-fs11 font-semibold text-fg-3">허용 기기 입실 전 세기 패턴</dt>
              <dd className="num mt-0.5 font-semibold">{a?.fingerprints ?? 0}대 대조 중</dd>
            </div>
          </dl>
        </div>
        {groups.map((g) => (
          <section key={g.key} className="border-b border-line p-4 last:border-b-0">
            <h3 className="mb-3 text-fs13 font-semibold text-fg-2">{g.title}</h3>
            <ul className="grid grid-cols-1 gap-3 expanded:grid-cols-2 large:grid-cols-3">
              {cat.filter((c) => c.group === g.key).map((c) => {
                const t = splitTitle(c.title)
                const st = ATTACK_STATE[c.status]
                const ran = injected.filter((r) => r.kind === c.kind)
                const got = ran.filter((r) => r.detected_at != null)
                const real = runs.filter((r) => !r.injected && r.kind === c.kind).length
                return (
                  <li key={c.kind} className="flex flex-col rounded-lg border border-line p-3.5">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0">
                        <div className="leading-snug font-semibold">{t.main}</div>
                        {t.sub && <div className="mt-0.5 text-xs leading-snug text-fg-3">{t.sub}</div>}
                      </div>
                      <Status tone={st.tone} className="ml-auto shrink-0 text-xs font-semibold">{st.label}</Status>
                    </div>
                    {(ran.length > 0 || real > 0) && (
                      <div className="num mt-2 flex flex-wrap gap-1.5 text-xs">
                        {ran.length > 0 && <Tag tone={got.length === ran.length ? "ok" : "warn"}>재현 {ran.length} · 탐지 {got.length}</Tag>}
                        {real > 0 && <Tag tone="danger">실제 탐지 {real}</Tag>}
                      </div>
                    )}
                    <Fold label="대응 · 남는 한계">
                      <Def k="대응">{c.response}</Def>
                      {c.limit && c.limit !== "-" && <Def k="한계">{c.limit}</Def>}
                    </Fold>
                    {c.replay && (
                      <Button size="sm" variant="secondary" className="mt-auto self-start" disabled={!canAttack || busy != null}
                        onClick={() => run(c.kind, () => api.injectAttack(c.kind))}>
                        <Swords />{ran.length ? `다시 재현 (${ran.length})` : "재현"}
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
function Fold({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group/f mt-2 mb-1 text-fs13">
      <summary className="flex items-center gap-1 text-xs font-semibold text-fg-3 hover:text-fg">
        <span className="inline-block transition-transform group-open/f:rotate-90">›</span>{label}
      </summary>
      <dl className="mt-1.5 space-y-1.5 text-fg-2">{children}</dl>
    </details>
  )
}
const Def = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 leading-snug">
    <dt className="font-semibold text-fg-3">{k}</dt>
    <dd>{children}</dd>
  </div>
)

/* ───────────── 장비 · 보안 탭 조각 ───────────── */

/** 교실 배치도: 네 모서리 천장 수신기 · 교탁 기준 비콘 · 가운데 좌석(흐리게) */
export function RoomEquipment({ status }: { status: LiveStatus | null }) {
  const nodes = status?.nodes ?? []
  const node = (id: string) => nodes.find((n) => n.node_id === id)
  const beacon = status?.health?.beacon === "frozen" ? { tone: "warn" as Tone, text: "보정 정지" } : status?.beacon_ok ? { tone: "ok" as Tone, text: "실시간 보정" } : { tone: "off" as Tone, text: "끊김" }
  const pos: Record<string, string> = { R1: "top-2 left-2", R2: "top-2 right-2", R3: "bottom-2 left-2", R4: "bottom-2 right-2" }
  const card = (id: string, extra?: string) => <NodeCard key={id} id={id} n={node(id)} className={extra} />
  return (
    <>
    {/* 휴대폰: 배치도 대신 2×2 */}
    <div className="grid grid-cols-2 gap-2 medium:hidden">
      {(["R1", "R2", "R3", "R4"] as const).map((id) => card(id, "w-auto"))}
      <div className="col-span-2 rounded-md border border-line-strong bg-surface px-2.5 py-2">
        <Status tone={beacon.tone} className="text-xs"><span className="font-semibold">기준 비콘 · 교탁</span> <span className="text-fg-3">{beacon.text}</span></Status>
      </div>
    </div>
    <div className="relative mx-auto hidden h-[300px] max-w-[640px] rounded-lg border-2 border-dashed border-line-strong bg-subtle/70 medium:block">
      {/* 좌석 40석 (자리 감만) · 모서리 수신기 카드와 겹치지 않게 가운데로 */}
      <div aria-hidden className="absolute inset-x-[32%] top-[30%] bottom-[9%] grid grid-cols-10 grid-rows-4 gap-1">
        {Array.from({ length: 40 }, (_, i) => <span key={i} className="rounded-[3px] bg-line/80" />)}
      </div>
      {/* 교탁 + 기준 비콘 */}
      <div className="absolute top-3 left-1/2 w-[26%] min-w-28 -translate-x-1/2 rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-center">
        <div className="text-fs11 font-semibold text-fg-3">교탁</div>
        <Status tone={beacon.tone} className="justify-center text-xs"><span className="font-semibold">기준 비콘</span> <span className="text-fg-3">{beacon.text}</span></Status>
      </div>
      {(["R1", "R2", "R3", "R4"] as const).map((id) => card(id, cn("absolute", pos[id])))}
    </div>
    </>
  )
}

function NodeCard({ id, n, className }: { id: string; n?: LiveStatus["nodes"][number]; className?: string }) {
  const ok = n?.status === "online"
  return (
    <div className={cn("w-[11.5rem] rounded-md border bg-surface px-2.5 py-2", ok ? "border-line-strong" : "border-[1.5px] border-dashed border-danger bg-danger-soft", className)}>
      <div className="flex items-center gap-1.5">
        <span className={cn("grid size-5 place-items-center rounded", ok ? "bg-fg-3 text-surface" : "bg-danger text-white")}>
          {ok ? <Radio className="size-3" /> : <X className="size-3" strokeWidth={3} />}
        </span>
        <span className="text-sm font-bold">수신기 {id}</span>
        {ok && n?.cert_ok && n?.fw_ok && <BadgeCheck className="ml-auto size-4 text-ok" aria-label="인증서 · 펌웨어 서명 확인" />}
      </div>
      {ok ? (
        <div className="num mt-1 grid grid-cols-2 gap-x-2 text-xs whitespace-nowrap text-fg-2">
          <span>{n?.rate != null ? `${n.rate}건/초` : "-"}</span>
          <span>기기 {n?.heard ?? "-"}</span>
          <span className={cn((n?.skew_ms ?? 0) > 200 && "font-semibold text-danger")}>시계 {n?.skew_ms ?? "-"}ms</span>
          <span>{n?.last_seen ? n.last_seen.slice(11, 19) : "-"}</span>
        </div>
      ) : (
        <div className="mt-1 text-xs font-semibold text-danger">응답 없음</div>
      )}
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

const PERMS: { what: string; roles: Record<Role, boolean> }[] = [
  { what: "감독 · 순회 · 결과 입력", roles: { supervisor: true, admin: true, auditor: false } },
  { what: "시험 준비 · 시작", roles: { supervisor: true, admin: true, auditor: false } },
  { what: "장애 재현 · 설정", roles: { supervisor: false, admin: true, auditor: false } },
  { what: "리포트 열람 · 내보내기", roles: { supervisor: true, admin: true, auditor: true } },
  { what: "접근 기록 열람", roles: { supervisor: false, admin: true, auditor: true } },
]

/** 보안: 아이콘 칸 6개 + 역할별 권한 */
export function SecurityBoard({ status, role }: { status: LiveStatus | null; role: Role }) {
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
    { icon: <EyeOff />, title: "기준값 비공개", desc: "기준값 · 가중치 · 허용 목록 · 해시 키", tone: "ok" },
    { icon: <KeyRound />, title: "관리자 2단계 인증", desc: "실기기 단계에서 적용 (지금은 역할 전환)", tone: "neutral" },
  ]
  return (
    <Panel title="보안 · 권한" aside={<span>지금 역할 <b className="text-fg">{ROLE_NAME[role]}</b></span>}>
      <div className="grid expanded:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] expanded:divide-x divide-line">
        <ul className="grid grid-cols-1 gap-2 p-4 medium:grid-cols-2">
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

/** 개인정보 최소화 · 보관 (기록되는 사람 대부분은 부정행위자가 아님) */
export function PrivacyBoard() {
  const items: { icon: ReactNode; title: string; desc: string }[] = [
    { icon: <Hash />, title: "주소는 해시만", desc: "원본 기기 주소는 저장 안 함" },
    { icon: <EyeOff />, title: "통신 내용 미수집", desc: "Wi-Fi는 길이 · 간격 · 방향만" },
    { icon: <Trash2 />, title: "원시 신호 7일 뒤 폐기", desc: "이의 제기 기간 뒤 삭제 · 판단 기록은 보관" },
    { icon: <Armchair />, title: "이름 대신 좌석 번호", desc: "수험생 신원은 기록하지 않음" },
    { icon: <FileSearch />, title: "열람도 기록", desc: "모든 열람 · 내보내기를 접근 기록에 남김" },
  ]
  return (
    <ul className="grid grid-cols-1 gap-2 p-4 medium:grid-cols-2 large:grid-cols-5">
      {items.map((i) => (
        <li key={i.title} className="flex items-start gap-3 rounded-md border border-line px-3 py-2.5 large:flex-col large:gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-brand-soft text-brand [&_svg]:size-4">{i.icon}</span>
          <span className="min-w-0">
            <span className="block text-fs13 font-semibold">{i.title}</span>
            <span className="block text-xs leading-snug text-fg-3">{i.desc}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}
