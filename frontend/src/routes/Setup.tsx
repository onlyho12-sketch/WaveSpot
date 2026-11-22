// 시험 준비: 장비 확인 → 입실 전 기준선 → 시험 시작 (실제 순서대로)
// 장비 점검 표 (측정값 + 양호 / 주의 배지, IBM Carbon 모양 + 색 + 글자), 위에 진행 단계 (Atlassian progress tracker)
// 시험 시작 전 확인 목록(휴대폰 수거 · 차폐 파우치)을 다 체크해야 감지 시작
// v11 10장: 자가 점검(수신기 4/4 · 기준 비콘 · 시계 동기화 · 저장 공간 · 펌웨어 서명 · 인증서 · AI 모델)을 통과해야만 '감지 시작'이 켜짐
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { Button } from "@/components/ui/button"
import { Panel, Status, Tracker } from "@/components/ui/status"
import { api, getRole, type Status as LiveStatus } from "@/lib/api"
import { patchStatus, useLive } from "@/lib/live"
import { cn, NODE_PLACE, type Tone } from "@/lib/utils"

export function Setup() {
  const status = useLive((s) => s.status)
  const navigate = useNavigate()
  const scenarios = useQuery({ queryKey: ["scenarios"], queryFn: api.scenarios })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("컴퓨터활용능력 2급")
  const [date, setDate] = useState(today)
  const [start, setStart] = useState("09:00")
  const [end, setEnd] = useState("09:40")
  const [place, setPlace] = useState("")
  const length = start && end ? toMin(end) - toMin(start) : 0 // 시험 시간 (분) · 서버도 10분 ~ 5시간만 받음
  const lengthOk = length >= 10 && length <= 300
  const [scenario, setScenario] = useState("demo")
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const doneCount = CHECKS.filter((c) => checks[c.key]).length
  const allChecked = doneCount === CHECKS.length
  const state = status?.session?.state ?? "setup"
  const nodes = status?.nodes ?? []
  const online = nodes.filter((n) => n.status === "online").length
  const checksList = status?.selfcheck ?? []
  const sysChecks = checksList.filter((c) => c.key !== "nodes" && c.key !== "beacon") // 수신기 · 비콘은 위 표에
  const selfOk = checksList.length > 0 && checksList.every((c) => c.ok !== false)
  const equipOk = online === nodes.length && nodes.length > 0 && !!status?.beacon_ok && selfOk
  const current = state === "setup" ? (equipOk ? 1 : 0) : state === "baseline" ? 2 : 3

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-3 medium:gap-4 expanded:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-3 medium:gap-4">
        <section className="rounded-lg border border-line bg-surface px-5 py-4">
          <div className="max-w-xl">
            <Tracker current={Math.min(current, 2)} steps={[{ key: 1, label: "자가 점검" }, { key: 2, label: "허용 기기 등록" }, { key: 3, label: "시험 시작" }]} />
          </div>
        </section>

        <Panel title="1. 자가 점검" aside={<Status passGreen tone={equipOk ? "ok" : "danger"}>{equipOk ? "모두 통과" : "확인 필요"}</Status>}>
          {/* 장비 점검 표 (항목마다 측정값 + 양호 / 주의 배지) */}
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-subtle text-left text-xs text-fg-3">
              <tr>
                <th className="w-24 px-4 py-2 font-semibold medium:w-28">상태</th>
                <th className="py-2 font-semibold">장비</th>
                <th className="hidden px-4 py-2 font-semibold medium:table-cell">위치</th>
                <th className="px-4 py-2 text-right font-semibold">받은 신호</th>
                <th className="py-2 pr-4 text-right font-semibold">감지된 기기</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {nodes.map((n) => {
                const g = grade(n)
                return (
                  <tr key={n.node_id} className={cn(g.tone === "warn" && "bg-warn-soft/50", g.tone === "off" && "bg-danger-soft/50")}>
                    <td className="px-4 py-2.5"><Status passGreen tone={g.tone}><span className="font-semibold">{g.label}</span></Status></td>
                    <td className="py-2.5 font-semibold whitespace-nowrap">수신기 {n.node_id}</td>
                    <td className="hidden px-4 py-2.5 text-fg-2 medium:table-cell">{NODE_PLACE[n.node_id] ?? "-"}</td>
                    <td className="num px-4 py-2.5 text-right whitespace-nowrap">{n.status === "online" && n.rate != null ? <>{n.rate.toFixed(1)}<span className="ml-0.5 text-xs text-fg-3">건/초</span></> : <span className="text-fg-3">-</span>}</td>
                    <td className="num py-2.5 pr-4 text-right whitespace-nowrap">{n.status === "online" && n.heard != null ? <>{n.heard}<span className="ml-0.5 text-xs text-fg-3">대</span></> : <span className="text-fg-3">-</span>}</td>
                  </tr>
                )
              })}
              <tr className={cn(!status?.beacon_ok && "bg-danger-soft/50")}>
                <td className="px-4 py-2.5"><Status passGreen tone={status?.beacon_ok ? "ok" : "off"}><span className="font-semibold">{status?.beacon_ok ? "양호" : "끊김"}</span></Status></td>
                <td className="py-2.5 font-semibold whitespace-nowrap">기준 비콘</td>
                <td className="hidden px-4 py-2.5 text-fg-2 medium:table-cell">교탁</td>
                <td className="px-4 py-2.5 text-right text-fg-3">-</td>
                <td className="py-2.5 pr-4 text-right text-fg-3">-</td>
              </tr>
            </tbody>
          </table>
          <div className="space-y-0.5 border-t border-line px-4 py-2 text-xs text-fg-3">
            <p>받은 신호: 이 수신기가 1초에 받은 신호 건수</p>
            <p>감지된 기기: 이 수신기에 신호가 들어온 기기 수</p>
            <p>최근 10초 기준이며 시험 중에는 1분마다 갱신합니다. 받은 신호가 0이면 확인하세요</p>
          </div>
          {sysChecks.length > 0 && (
            <ul className="grid divide-line border-t border-line text-sm medium:grid-cols-2 medium:divide-x">
              {sysChecks.map((c) => (
                <li key={c.key} className={cn("flex items-center gap-3 border-b border-line px-4 py-2.5", c.ok === false && "bg-danger-soft/50")}>
                  <Status passGreen tone={c.ok === false ? "off" : c.ok ? "ok" : "neutral"}><span className="w-9 font-semibold">{c.ok === false ? "실패" : c.ok ? "통과" : "보고 없음"}</span></Status>
                  <span className="font-semibold">{c.label}</span>
                  <span className="num ml-auto text-right text-fg-2">{c.value}</span>
                </li>
              ))}
            </ul>
          )}
          {!selfOk && checksList.length > 0 && (
            <p className="px-4 py-2 text-fs13 font-semibold text-danger">자가 점검을 모두 통과해야 허용 기기를 등록하고 감지를 시작할 수 있습니다.</p>
          )}
        </Panel>

        <Panel title="2. 허용 기기 등록">
          {state === "setup" && (
            <div className="px-4 py-3 text-sm text-fg-2">
              수험생 입실 전에 등록하세요.
              <p className="mt-0.5 text-fs13 text-fg-3">지금 교실에서 잡히는 감독관 휴대폰, 교실 TV 같은 기기를 등록해 탐지 대상에서 뺍니다.</p>
            </div>
          )}
          {(status?.allowlist.length ?? 0) > 0 && (
            <p className="border-b border-line bg-subtle px-4 py-2 text-fs13 text-fg-3">
              감독관 휴대폰, 교실 TV처럼 입실 전부터 교실에 있던 기기 {status?.allowlist.length}대. 탐지 대상에서 뺍니다.
            </p>
          )}
          {(status?.allowlist.length ?? 0) > 0 && (
            <ul className="divide-y divide-line text-sm">
              {status?.allowlist.map((a) => (
                <li key={a.device_id} className="flex items-center gap-3 px-4 py-2.5">
                  <Status passGreen tone="ok">허용</Status>
                  <span>{a.label.split(", ")[0]}</span>
                </li>
              ))}
            </ul>
          )}
          {state === "setup" && (
            <div className="border-t border-line px-4 py-3">
              <Button onClick={() => run("baseline", async () => patchStatus(await api.baseline()))} disabled={!!busy || !equipOk}>
                {busy === "baseline" ? "등록 중…" : "허용 기기 등록"}
              </Button>
              {!equipOk && <span className="ml-3 text-sm text-fg-3">자가 점검 먼저</span>}
            </div>
          )}
        </Panel>

        <Panel title="3. 시험 시작">
          {/* 기기 수거는 교실 감독관이 하는 일 → 관리자에게는 '확인받고 체크'라고 알림 */}
          {state !== "running" && state !== "ended" && getRole() !== "supervisor" && (
            <p className="border-b border-line px-4 py-2.5 text-fs13 text-fg-3">교실 감독관에게 확인받은 뒤 체크하세요.</p>
          )}
          {state !== "running" && state !== "ended" && (
            <ul className="divide-y divide-line border-b border-line">
              {CHECKS.map((c) => (
                <li key={c.key}>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 text-fs15 hover:bg-subtle">
                    <input type="checkbox" className="size-5 accent-brand" checked={!!checks[c.key]}
                      onChange={(e) => setChecks((v) => ({ ...v, [c.key]: e.target.checked }))} />
                    {c.label}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-4 px-4 py-3">
            <p className="min-w-0 flex-1 text-sm text-fg-2">
              {state === "running" || state === "ended" ? "시험 전 확인 완료" : allChecked ? "시작할 수 있습니다." : `확인 ${CHECKS.length - doneCount}개 남음`}
            </p>
            {state === "baseline" && (
              <Button size="lg" disabled={!!busy || !allChecked || !selfOk}
                onClick={() => run("start", async () => { patchStatus(await api.start()); navigate({ to: "/" }) })}>
                감지 시작
              </Button>
            )}
            {(state === "running" || state === "ended") && <Status passGreen tone="ok"><span className="text-sm font-semibold">{state === "running" ? "감지 중" : "시험 종료"}</span></Status>}
          </div>
        </Panel>

        {error && <div role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}
      </div>

      <aside className="flex flex-col gap-3 medium:gap-4">
        {/* 재생 속도 · 일시 정지 칸은 뺌 (시연은 서버 기본 30배속으로 진행) */}
        <Panel title="새 시험" bodyClass="flex flex-col gap-4 p-4">
          <Field label="시험 이름" htmlFor="exam-name">
            <input id="exam-name" value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
          </Field>
          <Field label="날짜" htmlFor="exam-date">
            <input id="exam-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
          </Field>
          <div className="grid grid-cols-2 gap-3 expanded:grid-cols-1">
            <Field label="시작 시각" htmlFor="exam-start">
              <input id="exam-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className={INPUT} />
            </Field>
            <Field label="종료 시각" htmlFor="exam-end">
              <input id="exam-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-describedby="exam-len" className={INPUT} />
            </Field>
          </div>
          <p id="exam-len" className={cn("-mt-2 text-fs13", lengthOk ? "text-fg-3" : "font-semibold text-danger")}>
            {lengthOk ? `시험 시간 ${length}분` : "종료 시각은 시작 시각보다 10분 이상, 5시간 이내로 늦어야 합니다."}
          </p>
          <Field label="장소" htmlFor="exam-place">
            <input id="exam-place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="예: 본관 301호" maxLength={40} className={INPUT} />
          </Field>
          <div>
            <Button className="w-full" disabled={!!busy || !name.trim() || !date || !lengthOk}
              onClick={() => run("new", async () => patchStatus(await api.newSession({ name: name.trim(), date, start, end, place: place.trim(), scenario })))}>
              새 시험 만들기
            </Button>
            <p className="mt-2 text-xs text-fg-3">진행 중인 시험은 종료됩니다.</p>
          </div>
        </Panel>

        {/* 녹화 재생(시연)일 때만: 부정행위 있음 / 없음 비교용 모의 데이터 선택 · 실제 출시판(수신기 연결)에는 없음 */}
        {status?.source === "replay" && (
          <Panel title="시연 데이터" aside={<span>시연판에만 있음</span>} bodyClass="p-4">
            <fieldset>
              <legend className="mb-1.5 text-fs13 text-fg-3">새 시험을 만들 때 재생할 모의 데이터</legend>
              <div className="divide-y divide-line rounded-md border border-line">
                {scenarios.data?.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-start gap-2.5 px-3 py-2.5 text-sm hover:bg-subtle">
                    <input type="radio" name="scenario" value={s.id} checked={scenario === s.id} onChange={() => setScenario(s.id)} className="mt-0.5 size-4 accent-brand" />
                    {s.title}
                  </label>
                ))}
              </div>
            </fieldset>
          </Panel>
        )}
      </aside>
    </div>
  )
}

/** 시험 전 확인 (v10 시험 전 절차) · 다 체크해야 감지 시작 */
const CHECKS = [
  { key: "collect", label: "휴대폰, 스마트워치 수거" },
  { key: "pouch", label: "수거한 기기를 차폐 파우치에 보관" },
]

/** 수신기 평가: 응답 없음 = 끊김 · 연결됐지만 최근 10초 받은 신호 0 = 주의 · 그 외 양호 */
function grade(n: LiveStatus["nodes"][number]): { tone: Tone; label: string } {
  if (n.status !== "online") return { tone: "off", label: "끊김" }
  if (n.rate == null) return { tone: "neutral", label: "측정 전" }
  if (n.rate === 0) return { tone: "warn", label: "주의" }
  return { tone: "ok", label: "양호" }
}

const INPUT = "h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-fs15 focus:border-brand focus:outline-none"

/** "13:30" -> 810 (자정부터 분) */
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))

/** 오늘 날짜 (기기 시간대 기준) YYYY-MM-DD */
function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// 라벨 안에 버튼을 넣으면 라벨 글자를 눌러도 첫 버튼이 눌리므로 div + htmlFor 로 분리
function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-fs13 font-semibold text-fg-2">{label}</label>
      {children}
    </div>
  )
}
