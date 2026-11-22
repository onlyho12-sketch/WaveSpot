// 대응 단계 흐름 (설계안 v11 그림 22 · 설계안 이름은 '수색 강화 사다리')
// Lv0 이상 없음 → Lv1 추가 관찰 → Lv2 휴대형 접근 → Lv3 정밀 수색 → 수색 결과
//   ├ 발견 → 규정대로 처리 · 정답으로 기록
//   ├ 미발견 · 신호 사라짐 → 오탐으로 기록
//   (v12) 시험 중 기준은 바꾸지 않음 · 기록한 결과는 시험 후 사람 검토를 거쳐 시험 없는 기간에 학습
//   └ 미발견 · 신호 지속 → Lv4 2차 수색 · 학습 보류 → 그래도 미발견이면 미해결 (사람 검토)
// 근거 서랍에서는 이 요청이 지금 어디인지 강조, 관리 화면에서는 단계마다 지금 몇 대인지 표시
// wide: 관리 화면처럼 넓은 곳은 Lv0~Lv3 을 가로로 (좁으면 세로)
import { ArrowDown } from "lucide-react"
import { Fragment, type ReactNode } from "react"
import type { SearchRequest } from "@/lib/api"
import { cn, type Tone } from "@/lib/utils"

type Id = "lv0" | "lv1" | "lv2" | "lv3" | "result" | "found" | "fp" | "lv4" | "unresolved"

const STEPS: { id: Id; tag: string; name: string; when: string; tone: Tone }[] = [
  { id: "lv0", tag: "Lv0", name: "이상 없음", when: "허용 목록 밖 신호 없음, 화면에 알림 없음", tone: "ok" },
  { id: "lv1", tag: "Lv1", name: "추가 관찰", when: "아직 확실하지 않아 에이전트가 30초 더 지켜봄", tone: "warn" },
  { id: "lv2", tag: "Lv2", name: "휴대형 접근", when: "위치가 좁혀졌거나 영상 통화, 사진 전송이 의심됨 → 휴대형으로 순회", tone: "warn" },
  { id: "lv3", tag: "Lv3", name: "정밀 수색", when: "기기가 있을 가능성이 높음 → 의심 좌석을 금속탐지기로", tone: "danger" },
]

// 감독관 화면이라 AI 학습 이야기는 넣지 않음 (결과 기록이 학습에 쓰이는 흐름은 시연 영상에서 설명)
const BRANCH: { id: Id; name: string; then: string; tone: Tone }[] = [
  { id: "found", name: "발견", then: "시험 규정대로 처리", tone: "neutral" },
  { id: "fp", name: "미발견 (신호 사라짐)", then: "잘못 잡은 신호 (오탐)", tone: "neutral" },
  { id: "lv4", name: "미발견 (신호 계속)", then: "Lv4 2차 수색 (소지품, 책상, 다른 부위)", tone: "danger" },
]

/** 요청 상태 → 지금 위치 · 지나온 단계 */
function where(req?: Pick<SearchRequest, "level" | "state">): { now: Id | null; done: Set<Id> } {
  if (!req) return { now: null, done: new Set() }
  const upTo = (n: number) => (["lv0", "lv1", "lv2", "lv3"] as Id[]).slice(0, n)
  const open = req.state === "open" || req.state === "searching"
  if (req.level === 4) {
    const base: Id[] = [...upTo(4), "result"]
    if (open) return { now: "lv4", done: new Set(base) }
    if (req.state === "found") return { now: "found", done: new Set([...base, "lv4"]) }
    return { now: "unresolved", done: new Set([...base, "lv4"]) }
  }
  if (open) return { now: (`lv${req.level}` as Id), done: new Set(upTo(req.level)) }
  if (req.state === "found") return { now: "found", done: new Set([...upTo(req.level + 1), "result"]) }
  if (req.state === "not_found") return { now: "fp", done: new Set([...upTo(req.level + 1), "result"]) }
  return { now: null, done: new Set(upTo(req.level + 1)) } // 허용 등록
}

const RING: Record<Tone, string> = {
  ok: "border-line-strong bg-subtle", warn: "border-warn-fill bg-warn-soft", danger: "border-danger bg-danger-soft",
  neutral: "border-fg bg-fg/[0.06]", off: "border-danger bg-danger-soft", brand: "border-brand bg-brand-soft",
}
const TAG: Record<Tone, string> = {
  ok: "bg-fg-3 text-white", warn: "bg-warn-fill text-white", danger: "bg-danger text-white", neutral: "bg-fg-2 text-white", off: "bg-danger text-white", brand: "bg-brand text-white",
}

export function LadderFlow({ req, counts, className, wide = false }: {
  req?: Pick<SearchRequest, "level" | "state">
  counts?: Partial<Record<Id, number>> // 관리 화면: 단계별 지금 수
  className?: string
  wide?: boolean
}) {
  const { now, done } = where(req)
  const focus = req != null
  const box = (id: Id, tone: Tone, children: ReactNode, extra?: string) => {
    const isNow = now === id
    const past = done.has(id)
    return (
      <div aria-current={isNow ? "step" : undefined}
        className={cn("relative rounded-md border px-3 py-2", extra,
          isNow ? cn("border-2", RING[tone]) : past ? "border-line-strong bg-surface" : "border-line bg-surface",
          focus && !isNow && !past && "opacity-55")}>
        {isNow && <span className="absolute -top-2.5 right-2 rounded-full bg-fg px-2 py-px text-fs11 font-bold text-surface">지금</span>}
        {children}
        {counts?.[id] != null && <span className="num absolute top-2 right-2 text-fs13 font-bold text-fg-2">{counts[id]}대</span>}
      </div>
    )
  }
  const down = <div className="flex justify-center py-0.5 text-fg-3"><ArrowDown className="size-4" /></div>
  const step = (s: (typeof STEPS)[number]) => (
    <div className={cn("flex items-start gap-2.5", counts?.[s.id] != null && "pr-10")}>
      <span className={cn("num mt-px rounded px-1.5 text-xs leading-5 font-bold", now === s.id || done.has(s.id) || !focus ? TAG[s.tone] : "bg-fg/10 text-fg-3")}>{s.tag}</span>
      <div className="min-w-0">
        <div className="font-semibold">{s.name}</div>
        <div className="text-fs13 leading-snug text-fg-2">{s.when}</div>
      </div>
    </div>
  )

  return (
    <div className={cn("@container text-fs14", className)} aria-label="에이전트 경보 단계 흐름">
      {wide ? (
        <div className="flex flex-col expanded:flex-row expanded:items-stretch">
          {STEPS.map((s, i) => (
            <Fragment key={s.id}>
              <div className="min-w-0 expanded:flex-1">{box(s.id, s.tone, step(s), "h-full")}</div>
              {i < STEPS.length - 1 && (
                <div className="flex justify-center py-0.5 text-fg-3 expanded:items-center expanded:px-1 expanded:py-0"><ArrowDown className="size-4 expanded:-rotate-90" /></div>
              )}
            </Fragment>
          ))}
        </div>
      ) : (
        STEPS.map((s, i) => (
          <div key={s.id}>
            {box(s.id, s.tone, step(s))}
            {i < STEPS.length - 1 && down}
          </div>
        ))
      )}
      {down}
      {box("result", "neutral", <div className="text-center font-semibold">수색 결과 입력 <span className="font-normal text-fg-3">(판정은 사람이 함)</span></div>)}

      {/* 세 갈래 · 담긴 칸이 좁으면(근거 서랍 · 휴대폰) 세로로 쌓음 */}
      <div className="relative mt-1 grid grid-cols-1 gap-2 pt-1 @lg:grid-cols-3 @lg:pt-4">
        <span aria-hidden className="absolute top-1.5 right-[16.6%] left-[16.6%] hidden h-px bg-line-strong @lg:block" />
        <span aria-hidden className="absolute top-0 left-1/2 hidden h-1.5 w-px bg-line-strong @lg:block" />
        {BRANCH.map((b) => (
          <div key={b.id} className="relative">
            <span aria-hidden className="absolute -top-2.5 left-1/2 hidden h-2.5 w-px bg-line-strong @lg:block" />
            {box(b.id, b.tone, (
              <div className="pr-9">
                <div className={cn("text-fs13 font-bold", b.id === "lv4" && "text-danger")}>{b.name}</div>
                <div className="mt-0.5 text-fs12 leading-snug text-fg-2">{b.then}</div>
              </div>
            ), "h-full")}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-2 @lg:grid-cols-3">
        <div className="@lg:col-start-3">
          {down}
          {box("unresolved", "warn", (
            <div className="pr-9">
              <div className="text-fs13 font-bold">2차에서도 미발견</div>
              <div className="mt-0.5 text-fs12 leading-snug text-fg-2">미해결로 기록. 시험 후 관리자가 검토해 결과를 정함</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
