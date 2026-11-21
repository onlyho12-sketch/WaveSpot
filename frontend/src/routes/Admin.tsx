// 관리 · 에이전트가 실제로 어떻게 돌아가는지 (심사 · 관리자용, 감독관 화면에는 넣지 않음)
// - 판단 흐름: 기기마다 '신호 감지 → 위치 추정 → 수색' (Datadog Bits 가설 트리: 거친 단계는 진하게, 멈춘 뒤 단계는 흐리게)
//   사용한 모델 / 건너뛴 모델, 더 지켜볼지 판단(얻는 확신 vs 놓칠 위험) → 파이프라인이 아니라 에이전트임을 보여줌
// - 모델 호출: 에이전트 vs 모든 신호에 6개 모델을 다 돌리는 파이프라인
// - 실시간 판단 기록(모델 칩 포함) · 추적 중 기기 표(Kismet) · 장비 · 데이터 출처
import { Check, Minus } from "lucide-react"
import { useMemo, useState } from "react"
import { AgentLog } from "@/components/monitor/AgentLog"
import { Panel, Shape, Status, Tag } from "@/components/ui/status"
import type { AgentEvent, TrackedDevice } from "@/lib/api"
import { useLive } from "@/lib/live"
import { cn, levelTone, modelName, NODE_PLACE, pct } from "@/lib/utils"

const MODELS = ["묶기", "안/밖", "위치", "종류", "용도", "점수"]
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

export function Admin() {
  const status = useLive((s) => s.status)
  const clock = useLive((s) => s.clock)
  const events = useLive((s) => s.events)
  const devices = useLive((s) => s.devices)
  const st = useLive((s) => s.stats)
  const requests = useLive((s) => s.requests)
  const list = useMemo(() => flows(events).slice(0, 6), [events])
  const saved = st && st.pipeline_calls ? Math.round((1 - st.agent_calls / st.pipeline_calls) * 100) : null
  const live = clock?.state === "running" && !clock.paused
  const kindOf = (id: string) => devices.find((d) => d.device_id === id)?.kind ?? Object.values(requests).find((r) => r.device_id === id)?.kind

  return (
    <div className="flex flex-col gap-3 medium:gap-4">
      <Panel>
        <div className="grid grid-cols-2 divide-line max-medium:divide-y medium:grid-cols-4 medium:divide-x">
          <Kpi label="모델 호출 절감" value={saved == null ? "-" : `−${saved}%`} tone="ok" note={st ? `에이전트 ${st.agent_calls.toLocaleString()} / 파이프라인 ${st.pipeline_calls.toLocaleString()}회` : undefined} />
          <Kpi label="처리한 10초 창" value={st ? st.windows.toLocaleString() : "-"} note={st ? `기기별 판단 ${st.device_windows.toLocaleString()}회` : undefined} />
          <Kpi label="확인 중인 신호" value={String(devices.length)} note={`허용 목록 ${status?.allowlist.length ?? 0}대`} />
          <Kpi label="판단 기록" value={String(events.length)} note={live ? "실시간으로 받는 중" : clock?.paused ? "일시 정지" : "시작 전"} />
        </div>
        {st && st.pipeline_calls > 0 && (
          <div className="space-y-2 border-t border-line px-4 py-3 text-[13px]">
            <Bar label="에이전트" value={st.agent_calls} max={st.pipeline_calls} cls="bg-brand" />
            <Bar label="파이프라인" value={st.pipeline_calls} max={st.pipeline_calls} cls="bg-fg-3/60" />
            <p className="text-xs text-fg-3">파이프라인 = 10초 창마다 모든 기기에 모델 6개를 전부 실행. 에이전트는 필요한 모델만 호출: 허용 기기는 기기 연결만, 교실 밖 신호는 기기 연결 · 교실 안/밖까지만 보고 멈춤.</p>
          </div>
        )}
      </Panel>

      <div className="grid gap-3 medium:gap-4 expanded:grid-cols-2">
        <Panel title={<span className="flex items-center gap-2"><Pulse on={live} />에이전트 판단 흐름</span>} aside={<span>최근 기기 {list.length}개</span>}>
          {list.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-fg-3">아직 판단한 신호가 없습니다.</p>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((f) => <FlowRow key={f.id} f={f} kind={kindOf(f.id)} dev={devices.find((d) => d.device_id === f.id)} />)}
            </ul>
          )}
        </Panel>

        <Panel title={<span className="flex items-center gap-2"><Pulse on={live} />실시간 판단 기록</span>} aside={<span className="flex items-center gap-2"><span className="rounded-sm bg-fg-2 px-1.5 text-[11px] font-semibold text-white">사용한 모델</span><span className="rounded-sm border border-line px-1.5 text-[11px] text-fg-3 line-through">건너뛴 모델</span></span>}>
          <div className="max-h-[640px] overflow-y-auto">
            <AgentLog events={events} showCalls />
          </div>
        </Panel>
      </div>

      <DeviceTable devices={devices} allowlist={status?.allowlist ?? []} />

      <div className="grid gap-3 medium:gap-4 expanded:grid-cols-2">
        <Panel title="장비">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {(status?.nodes ?? []).map((n) => (
                <tr key={n.node_id}>
                  <td className="px-4 py-2.5"><Status tone={n.status === "online" ? "ok" : "off"}>{n.status === "online" ? "정상" : "끊김"}</Status></td>
                  <td className="py-2.5 font-semibold">수신기 {n.node_id}</td>
                  <td className="py-2.5 text-fg-2">{NODE_PLACE[n.node_id]}</td>
                  <td className="num px-4 py-2.5 text-right text-fg-3">{n.last_seen ? n.last_seen.slice(11, 19) : "-"}</td>
                </tr>
              ))}
              <tr>
                <td className="px-4 py-2.5"><Status tone={status?.beacon_ok ? "ok" : "off"}>{status?.beacon_ok ? "정상" : "끊김"}</Status></td>
                <td className="py-2.5 font-semibold">기준 비콘</td>
                <td className="py-2.5 text-fg-2">교탁</td>
                <td className="px-4 py-2.5 text-right text-fg-3">실시간 보정</td>
              </tr>
            </tbody>
          </table>
        </Panel>
        <Panel title="데이터 출처" bodyClass="px-4 py-3 text-sm text-fg-2 space-y-2">
          <p><b className="text-fg">{status?.source === "replay" ? "녹화 재생" : "실제 수신기 (MQTT)"}</b>{status?.scenario_title ? ` · ${status.scenario_title}` : ""}</p>
          {status?.simulated && (
            <p>설치형 · 휴대형 세기와 Wi-Fi 프레임은 공개 데이터와 논문 수치로 만든 근거 기반 모의 데이터입니다 (실측 아님). 위치 · 교실 안/밖 · Wi-Fi 용도 모델도 이 모의 데이터로 학습했습니다.</p>
          )}
          <p className="text-fg-3">기기 주소는 해시로만 저장 · 시험 후 원본 폐기 · 수험생 이름 대신 좌석 번호.</p>
        </Panel>
      </div>
    </div>
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
    <Panel title="추적 중 기기" aside={<span>교실 안에서 잡힌 신호</span>}>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2">
        {FILTERS.map((x) => (
          <button key={x.key} role="tab" type="button" aria-selected={f === x.key} onClick={() => setF(x.key)}
            className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold", f === x.key ? "bg-fg text-white" : "text-fg-2 hover:bg-fg/5")}>
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
                  <td className="num py-2.5">{d.zone}구역 <span className="text-fg-3">{pct(d.zone_prob)}</span></td>
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
        <span className="num font-semibold">{f.id}</span>
        {kind && <span className="text-fg-2">{kind}</span>}
        {dev && <Tag tone={levelTone(dev.level)}>Lv{dev.level} · 위험 {dev.score}점</Tag>}
        {ended && <Tag>확인 끝</Tag>}
        <span className="num ml-auto text-xs text-fg-3">{f.last.clock}</span>
      </div>

      {/* 판단 순서: 거친 단계 진하게, 멈춘 뒤 단계는 점선 · 흐리게 */}
      <ol className="mt-2.5 grid grid-cols-3 gap-0">
        {f.stages.map((s, i) => {
          const done = s.n > 0
          const current = i === lastIdx && !ended
          return (
            <li key={s.name} className="relative min-w-0 pr-3">
              {i < 2 && <span className={cn("absolute top-[13px] right-0 left-7 h-0.5", reached[i + 1] ? "bg-ok" : "border-t-2 border-dashed border-line-strong")} />}
              <span className={cn("relative z-10 grid size-7 place-items-center rounded-full border-2 text-xs font-bold",
                current ? "border-brand bg-brand text-white" : done ? "border-ok bg-ok text-white" : "border-dashed border-line-strong bg-surface text-fg-3")}>
                {done && !current ? <Check className="size-3.5" strokeWidth={3} /> : !done ? <Minus className="size-3.5" /> : i + 1}
              </span>
              <div className={cn("mt-1 text-[13px] font-semibold", !done && "text-fg-3")}>{s.name}{s.n > 1 ? <span className="num ml-1 font-medium text-fg-3">{s.n}회</span> : null}</div>
              <div className={cn("line-clamp-2 text-xs leading-snug", done ? "text-fg-2" : "text-fg-3/70")}>
                {s.ev ? s.ev.message.replace(/\s*\([^)]*\)/g, "") : ended ? "필요 없어 건너뜀" : "아직 안 함"}
              </div>
            </li>
          )
        })}
      </ol>

      <div className="mt-2.5 flex flex-wrap items-center gap-1 text-[11px]">
        {f.calls.map((c) => <span key={c} className="rounded-sm bg-fg-2 px-1.5 py-px font-semibold text-white">{modelName(c)}</span>)}
        {f.skipped.map((c) => <span key={c} className="rounded-sm border border-line px-1.5 py-px text-fg-3 line-through">{modelName(c)}</span>)}
        {f.wait && (
          <span className={cn("num ml-auto text-xs", f.wait.gain > f.wait.loss ? "text-warn" : "text-danger")}>
            더 지켜보면 얻는 확신 {f.wait.gain.toFixed(2)} {f.wait.gain > f.wait.loss ? ">" : "≤"} 놓칠 위험 {f.wait.loss.toFixed(2)} → {f.wait.gain > f.wait.loss ? "더 지켜봄" : "바로 접근"}
          </span>
        )}
      </div>
    </li>
  )
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "ok" }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[13px] font-semibold text-fg-3">{label}</div>
      <div className={cn("num mt-1 text-[28px] leading-none font-bold", tone === "ok" && "text-ok")}>{value}</div>
      {note && <div className="num mt-1.5 text-xs text-fg-3">{note}</div>}
    </div>
  )
}

function Bar({ label, value, max, cls }: { label: string; value: number; max: number; cls: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-3">
      <span className="font-semibold text-fg-2">{label}</span>
      <span className="h-3 overflow-hidden rounded-sm bg-subtle"><span className={cn("block h-full", cls)} style={{ width: `${(value / max) * 100}%` }} /></span>
      <span className="num text-right">{value.toLocaleString()}회</span>
    </div>
  )
}

function ScoreMini({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="relative h-2 flex-1 rounded-sm bg-subtle">
        <span className={cn("absolute inset-y-0 left-0 rounded-sm", score >= 70 ? "bg-danger" : score >= 40 ? "bg-warn-fill" : "bg-ok")} style={{ width: `${Math.min(100, score)}%` }} />
        <span className="absolute -inset-y-1 left-[70%] w-px bg-fg" />
      </span>
      <span className="num w-7 text-right font-semibold">{score}</span>
    </div>
  )
}

export function Pulse({ on }: { on: boolean }) {
  return (
    <span className="relative flex size-2.5">
      {on && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />}
      <span className={cn("relative inline-flex size-2.5 rounded-full", on ? "bg-ok" : "bg-fg-3")} />
    </span>
  )
}
