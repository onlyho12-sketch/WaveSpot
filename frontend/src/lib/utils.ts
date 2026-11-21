import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import type { AgentEvent, SearchRequest } from "./api"

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

export type Tone = "ok" | "warn" | "danger" | "off" | "neutral" | "brand"

/** 반쪽 줄 구역(5석) -> 좌석 번호 */
export const seatsOfZone = (zone: number) => Array.from({ length: 5 }, (_, i) => (zone - 1) * 5 + i + 1)
export const zoneOfSeat = (seat: number) => Math.floor((seat - 1) / 5) + 1
export const pct = (p: number | null | undefined) => (p == null ? "-" : `${Math.round(p * 100)}%`)

/** 설치형 수신기 = 천장 네 모서리 (앞 왼쪽 R1 · 앞 오른쪽 R2 · 뒤 왼쪽 R3 · 뒤 오른쪽 R4) */
export const NODE_SEATS: Record<string, number> = { R1: 1, R2: 10, R3: 31, R4: 40 }
export const NODE_PLACE: Record<string, string> = { R1: "앞 왼쪽", R2: "앞 오른쪽", R3: "뒤 왼쪽", R4: "뒤 오른쪽" }

export const LEVELS = [
  { lv: 0, name: "감시", desc: "허용 목록 밖 신호 없음" },
  { lv: 1, name: "추가 관찰", desc: "30초 더 듣기" },
  { lv: 2, name: "휴대형 접근", desc: "구역 순회 · 좌석 옆 2초" },
  { lv: 3, name: "정밀 수색", desc: "의심 좌석 · 금속탐지기" },
  { lv: 4, name: "2차 수색", desc: "신호가 남으면 다시" },
] as const

export const levelTone = (lv: number): Tone => (lv >= 3 ? "danger" : lv >= 1 ? "warn" : "ok")

/** 시험 시작 시각 + 경과 초 -> "09:07" */
export function clockOf(t: number, start = "09:00", withSec = false) {
  const [h, m] = start.split(":").map(Number)
  const s = Math.floor(h * 3600 + m * 60 + t)
  const hh = String(Math.floor(s / 3600)).padStart(2, "0")
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0")
  return withSec ? `${hh}:${mm}:${String(s % 60).padStart(2, "0")}` : `${hh}:${mm}`
}

/** 기기의 최초 등장 · 마지막 감지 시각 (에이전트 기록에서) */
export function deviceSeen(events: AgentEvent[], deviceId: string) {
  let first: AgentEvent | null = null
  let last: AgentEvent | null = null
  for (const e of events) {
    if (e.device_id !== deviceId || e.sim_time < 0) continue
    if (!first || e.sim_time < first.sim_time) first = e
    if (!last || e.sim_time > last.sim_time) last = e
  }
  return { first: first?.clock ?? null, last: last?.clock ?? null }
}

export const isOpen = (r: SearchRequest) => r.state === "open" || r.state === "searching"

/** 에이전트가 부르는 AI 모델 이름 (서버 data.calls 값) → 화면 이름 */
export const MODEL_LABEL: Record<string, string> = { 묶기: "기기 연결", "안/밖": "교실 안/밖" }
export const modelName = (m: string) => MODEL_LABEL[m] ?? m

export const DONE_LABEL: Record<string, string> = { found: "기기 발견", not_found: "미발견", unresolved: "미해결", allowed: "허용 등록" }
