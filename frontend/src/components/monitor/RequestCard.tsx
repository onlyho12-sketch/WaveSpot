// 수색 요청 카드 ('AI 감지' 패널: 점수 원형 배지 + 제목 + 근거 2줄 + 버튼 2개 = v10 두 번 터치 원칙)
// 근거 서랍 (Kismet 상세 서랍 · Atlassian 진행 단계). 감독관에게 필요한 것만: 근거 몇 줄 · 틀릴 수 있는 이유 · 볼 곳 · 할 일
// 점수는 카드 배지 하나만 (레퍼런스 v10 27번). 확률 · 모델 출처 · 조사 로그는 기록 · 관리 화면에만
import { useNavigate } from "@tanstack/react-router"
import { ChevronDown, Footprints, ScanSearch } from "lucide-react"
import { type ReactNode, useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet } from "@/components/ui/sheet"
import { Tag, Tracker } from "@/components/ui/status"
import { api, type Evidence, type SearchRequest } from "@/lib/api"
import { patchRequest, useLive } from "@/lib/live"
import { clockOf, cn, deviceSeen, DONE_LABEL, isOpen } from "@/lib/utils"

const TITLE: Record<number, string> = { 2: "휴대형 접근 요청", 3: "정밀 수색 요청", 4: "2차 수색 요청" }
export const requestTitle = (r: SearchRequest) => TITLE[r.level] ?? "요청"
export const target = (r: SearchRequest) => (r.suspect_seat && r.level >= 3 ? `${r.suspect_seat}번 좌석` : `${r.zone}구역`)
export const targetSub = (r: SearchRequest) =>
  r.suspect_seat && r.level >= 3 ? r.kind + " 추정" : `${r.seats[0]}~${r.seats.at(-1)}번${r.zone2 ? ` · 2순위 ${r.zone2}구역` : ""}`

/** 사다리 단계 이름 (휴대폰은 짧게) */
export const LADDER = [
  { key: 1, short: "관찰", full: "추가 관찰" },
  { key: 2, short: "접근", full: "휴대형 접근" },
  { key: 3, short: "정밀 수색", full: "정밀 수색" },
  { key: 4, short: "2차 수색", full: "2차 수색" },
].map((s) => ({ key: s.key, label: <><span className="medium:hidden">{s.short}</span><span className="hidden medium:inline">{s.full}</span></> }))

function action(req: SearchRequest): { label: string; walk: boolean } | null {
  if (!isOpen(req)) return null
  if (req.state === "searching") return { label: "순회 화면으로", walk: false }
  if (req.level === 4) return { label: "다시 돌아보기", walk: true }
  if (req.level === 3 && req.suspect_seat) return { label: "수색 결과 입력", walk: false }
  return { label: "휴대형으로 접근", walk: true }
}

export function useGo(req: SearchRequest, after?: () => void) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const act = action(req)
  async function go() {
    if (!act) return
    setBusy(true)
    try {
      if (act.walk) patchRequest(await api.startSearch(req.id))
      after?.()
      navigate({ to: "/roam/$id", params: { id: String(req.id) } })
    } finally {
      setBusy(false)
    }
  }
  return { act, go, busy }
}

/** 위험 점수 원형 배지. v10 판단 규칙: 40~69 주황(추가 조사) · 70 이상 빨강(수색 요청) */
export function ScoreBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  const tone = score >= 70 ? "border-danger bg-danger-soft text-danger" : score >= 40 ? "border-warn-fill bg-warn-soft text-warn" : "border-line-strong bg-subtle text-fg-2"
  return (
    <span title={`위험 점수 ${score}점`} aria-label={`위험 점수 ${score}점`}
      className={cn("num grid shrink-0 place-items-center rounded-full border-2 font-bold", size === "md" ? "size-11 text-[17px]" : "size-8 text-[13px]", tone)}>
      {score}
    </span>
  )
}

/** 카드에 보일 근거 2줄: 점수 기여가 큰 순서 */
const topReasons = (req: SearchRequest, n = 2) =>
  req.evidence
    .filter((e) => e.label !== "조사 기록" && e.label !== "대략 구역" && e.label !== "기기 종류")
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, n)

/**
 * flush: 'AI 감지' 패널 안의 목록 한 줄 (테두리 없이 구분선으로) · 기본: 단독 카드 (기록 화면)
 */
export function RequestCard({ req, startLabel = "09:00", flush = false }: { req: SearchRequest; startLabel?: string; flush?: boolean }) {
  const [open, setOpen] = useState(false)
  const events = useLive((s) => s.events)
  const since = deviceSeen(events, req.device_id).first?.slice(0, 5)
  const { act, go, busy } = useGo(req)
  const tone = req.level >= 3 ? "danger" : "warn"

  if (!isOpen(req)) {
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}
          className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-subtle", !flush && "rounded-lg border border-line bg-surface")}>
          <Tag tone="neutral" solid={req.state === "found"}>{DONE_LABEL[req.state]}</Tag>
          <span className="min-w-0 flex-1 truncate font-semibold">{req.found_seat ? `${req.found_seat}번 좌석` : target(req)}</span>
          <span className="num text-sm text-fg-3">{clockOf(req.sim_time, startLabel)}</span>
        </button>
        <EvidenceSheet req={req} open={open} onOpenChange={setOpen} />
      </>
    )
  }

  const zoneCase = !(req.suspect_seat && req.level >= 3)
  return (
    <article className={cn("px-4 py-4", flush ? (tone === "danger" ? "bg-danger-soft/40" : "") : cn("rounded-lg border-2 bg-surface", tone === "danger" ? "border-danger/60" : "border-warn-fill/60"))}>
      <div className="flex gap-3">
        <ScoreBadge score={req.score} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold">
            <span className={tone === "danger" ? "text-danger" : "text-warn"}>{requestTitle(req)}</span>
            {since && <span className="num font-medium text-fg-3">· {since}부터</span>}
            {req.state === "searching" && <Tag tone="brand" className="ml-auto">순회 중</Tag>}
          </div>
          <div className="mt-0.5 text-[19px] leading-snug font-bold">{target(req)} · {req.kind} 추정</div>
          {zoneCase && <div className="num text-[13px] text-fg-3">{targetSub(req)}</div>}
          <ul className="mt-2 space-y-1">
            {topReasons(req).map((e) => (
              <li key={e.label} className="grid grid-cols-[4.5rem_1fr] gap-2 text-[14px] leading-snug">
                <span className="font-semibold text-fg-2">{e.label}</span>
                <span className="min-w-0 truncate text-fg-2">{plain(e.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setOpen(true)}>근거 보기</Button>
        {act && (
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={go} disabled={busy}>
            {act.walk ? <Footprints /> : <ScanSearch />}
            {act.label}
          </Button>
        )}
      </div>
      <EvidenceSheet req={req} open={open} onOpenChange={setOpen} />
    </article>
  )
}

/** 근거 문장을 감독관용으로 줄임: 괄호 속 기술값 · 두 번째 이후 항목 제거 */
const plain = (v: string) => v.replace(/\s*\([^)]*\)/g, "").split(" · ")[0].replace("안일 확률", "가능성")

export function EvidenceSheet({ req, open, onOpenChange }: { req: SearchRequest; open: boolean; onOpenChange: (o: boolean) => void }) {
  const events = useLive((s) => s.events)
  const { act, go, busy } = useGo(req, () => onOpenChange(false))
  const facts = req.evidence.filter((e) => e.label !== "조사 기록" && e.label !== "대략 구역")
  const since = deviceSeen(events, req.device_id).first?.slice(0, 5)
  const tone = req.level >= 3 ? "danger" : "warn"

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`${target(req)} · ${req.kind} 추정`}
      description={
        <span className="num">
          {since ? `${since}부터 감지` : ""}
          {!isOpen(req) && ` · ${DONE_LABEL[req.state]}${req.found_seat ? ` (${req.found_seat}번)` : ""}`}
        </span>
      }
      top={<Tracker steps={LADDER} current={req.level - 1} tone={tone} />}
      footer={
        act ? (
          <Button variant={tone === "danger" ? "danger" : "primary"} size="lg" className="w-full" onClick={go} disabled={busy}>
            {act.walk ? <Footprints /> : <ScanSearch />}
            {act.label}
          </Button>
        ) : undefined
      }
    >
      <Section title="근거">
        <SourceTabs req={req} facts={facts} />
      </Section>

      {req.counter?.length > 0 && (
        <Section title="틀릴 수 있는 이유">
          <ul className="space-y-1.5 text-[15px] text-fg-2">
            {req.counter.map((c) => (
              <li key={c} className="flex gap-2"><span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-fg-3" />{c.replace(/\s*\([^)]*\)/g, "")}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={req.level === 4 ? "다시 볼 곳" : "금속탐지기로 볼 곳"}>
        <PartChips parts={req.search_parts} />
      </Section>

      <Section title="수색 후 할 일">
        <Steps items={["위 부위를 금속탐지기로 확인", "결과 입력", "발견한 기기는 차폐 파우치에 보관"]} />
      </Section>
    </Sheet>
  )
}

const isWifi = (e: Evidence) => e.label === "통신 용도" || e.value.includes("Wi-Fi")

/** 신호원별 근거 탭 (설치형 수신기 · 휴대형 · Wi-Fi) */
function SourceTabs({ req, facts }: { req: SearchRequest; facts: Evidence[] }) {
  const fixed = facts.filter((e) => !isWifi(e))
  const wifi = facts.filter(isWifi)
  const walk = req.walk?.seat_medians ? Object.entries(req.walk.seat_medians).map(([k, v]) => ({ seat: Number(k), v })).sort((a, b) => b.v - a.v) : []
  const tabs = [
    { key: "fixed", label: "천장 수신기", n: fixed.length },
    { key: "hand", label: "휴대형", n: walk.length ? 1 : 0 },
    { key: "wifi", label: "Wi-Fi", n: wifi.length },
  ] as const
  const [tab, setTab] = useState<(typeof tabs)[number]["key"]>("fixed")
  const rows = (list: Evidence[]) => (
    <ul className="divide-y divide-line">
      {list.map((e) => (
        <li key={e.label} className="grid grid-cols-[5.5rem_1fr] gap-3 py-2.5 text-[15px]">
          <span className="font-semibold">{e.label}</span>
          <span className="text-fg-2">{plain(e.value)}</span>
        </li>
      ))}
    </ul>
  )
  const lo = Math.min(...walk.map((w) => w.v)), hi = Math.max(...walk.map((w) => w.v))
  return (
    <div>
      <div role="tablist" className="mb-2 grid grid-cols-3 rounded-md border border-line-strong p-0.5">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn("h-9 rounded-[5px] text-[13px] font-semibold", tab === t.key ? "bg-fg text-surface" : "text-fg-2 hover:bg-fg/5", t.n === 0 && tab !== t.key && "text-fg-3")}>
            {t.label}{t.n > 0 && t.key !== "hand" ? <span className="num ml-1 opacity-70">{t.n}</span> : null}
          </button>
        ))}
      </div>
      {tab === "fixed" && rows(fixed)}
      {tab === "wifi" && (wifi.length ? rows(wifi) : <p className="py-4 text-center text-sm text-fg-3">Wi-Fi 신호 없음 · 블루투스만 잡힘</p>)}
      {tab === "hand" && (walk.length ? (
        <ul className="space-y-1.5 py-1">
          <li className="pb-1 text-[13px] text-fg-3">순회하며 강하게 들린 좌석 순서</li>
          {walk.slice(0, 5).map((w, i) => (
            <li key={w.seat} className="grid grid-cols-[3.5rem_1fr] items-center gap-3 text-[15px]">
              <span className={cn("num font-semibold", i === 0 && "text-danger")}>{w.seat}번</span>
              <span className="h-2 overflow-hidden rounded-sm bg-subtle"><span className={cn("block h-full", i === 0 ? "bg-danger" : "bg-fg-3/50")} style={{ width: `${hi > lo ? Math.max(4, ((w.v - lo) / (hi - lo)) * 100) : 100}%` }} /></span>
            </li>
          ))}
        </ul>
      ) : <p className="py-4 text-center text-sm text-fg-3">아직 휴대형으로 돌지 않았습니다.</p>)}
    </div>
  )
}

export function PartChips({ parts }: { parts: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {parts.map((p) => <span key={p} className="rounded border border-line-strong px-2.5 py-1 text-[15px]">{p}</span>)}
    </div>
  )
}

export function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2 text-[15px]">
      {items.map((t, i) => (
        <li key={t} className="flex items-center gap-3">
          <span className="num grid size-6 shrink-0 place-items-center rounded-full border border-line-strong text-xs font-semibold">{i + 1}</span>{t}
        </li>
      ))}
    </ol>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details open className="group border-b border-line">
      <summary className="flex h-12 items-center gap-2 px-5 hover:bg-subtle">
        <ChevronDown className="size-4 -rotate-90 text-fg-3 transition-transform group-open:rotate-0" />
        <span className="text-[15px] font-semibold">{title}</span>
      </summary>
      <div className="px-5 pt-1 pb-5">{children}</div>
    </details>
  )
}
