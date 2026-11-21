// 백엔드 REST 와 데이터 형식 (backend/app/models.py · agent.py 와 맞춤)

export type Evidence = { label: string; value: string; source: string; points: number | null }

export type Level = 0 | 1 | 2 | 3 | 4

export type SearchRequest = {
  id: number
  device_id: string
  level: 2 | 3 | 4 // 수색 강화 사다리: 휴대형 접근 · 정밀 수색 · 2차 수색
  zone: number
  zone_prob: number
  zone2: number | null
  zone2_prob: number | null
  seats: number[]
  score: number
  kind: string
  state: "open" | "searching" | "found" | "not_found" | "unresolved" | "allowed"
  evidence: Evidence[]
  counter: string[] // 반대 근거
  search_parts: string[]
  suspect_seat: number | null
  walk: { seat_medians: Record<string, number>; best_seat: number | null; zones: number[] } | null
  sim_time: number
  found_seat: number | null
  note: string | null
}

export type AgentEvent = {
  id: number
  sim_time: number
  clock: string
  device_id: string | null
  stage: "준비" | "신호 감지" | "위치 추정" | "수색" | "결과 반영" | "장비"
  level: "info" | "caution" | "alert" | "done"
  message: string
  data: { calls?: string[]; skipped?: string[]; gain?: number; loss?: number } | null
}

export type TrackedDevice = {
  device_id: string
  status: "observing" | "caution" | "approach" | "requested" | "searching"
  level: Level
  hold: boolean
  score: number
  zone: number
  zone_prob: number
  zone2: number | null
  zone2_prob: number | null
  kind: string
  request_id: number | null
}

export type Clock = {
  t: number
  clock: string
  minute: number
  duration_min: number
  state: "setup" | "baseline" | "running" | "ended"
  paused: boolean
  speed: number
}

export type Status = {
  session: { id: number; name: string; rows: number; cols: number; state: Clock["state"]; scenario: string; exam_start_label: string; duration_min: number } | null
  source: "replay" | "mqtt"
  simulated: boolean
  stats: Stats | null
  scenario_title: string | null
  nodes: { node_id: string; status: string; last_seen: string | null; rate: number | null; heard: number | null }[] // rate 최근 10초 초당 받은 신호 · heard 들린 기기 수
  beacon_ok: boolean
  allowlist: { device_id: string; label: string }[]
  clock: Clock
}

export type Note = { id: number; sim_time: number; clock: string; text: string }

export type Stats = { windows: number; device_windows: number; agent_calls: number; pipeline_calls: number }

// 휴대형 순회: 걸음마다 세기와 '이번 순회 최고값 대비 차이', 끝나면 좌석별 결과
export type HandheldStep = { request_id: number; zone: number; zones?: number[]; zone_index?: number; dwell?: number; level: "far" | "near" | "nearest"; pos_seat: number; pass: number; rssi: number; rel_db: number }
export type HandheldDone = { request_id: number; done: true; best_seat: number | null; seat_medians: Record<string, number> }
export type Handheld = { step: HandheldStep | null; done: HandheldDone | null }

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.detail ?? `서버 응답 오류 (${res.status})`)
  }
  return res.json()
}

export const api = {
  status: () => call<Status>("GET", "/status"),
  scenarios: () => call<{ id: string; title: string }[]>("GET", "/scenarios"),
  newSession: (b: { name: string; scenario: string }) => call<Status>("POST", "/session", b),
  baseline: () => call<Status & { added: { device_id: string; label: string }[] }>("POST", "/session/baseline"),
  start: () => call<Status>("POST", "/session/start"),
  control: (b: { action: "pause" | "resume"; speed?: number }) => call<Status>("POST", "/session/control", b),
  requests: () => call<SearchRequest[]>("GET", "/requests"),
  events: () => call<AgentEvent[]>("GET", "/events"),
  // route: 감독관이 정한 순회 경로(구역 순서) · dwell 좌석당 머무는 초
  startSearch: (id: number, again = false, route?: { zones: number[]; dwell: number }) =>
    call<SearchRequest>("POST", `/requests/${id}/start${again ? "?again=true" : ""}`, route),
  allow: (device_id: string, label = "감독관 등록") => call<Status & { closed: number[] }>("POST", "/allowlist", { device_id, label }),
  result: (id: number, b: { found: boolean; seat?: number | null; note?: string }) => call<SearchRequest>("POST", `/requests/${id}/result`, b),
  notes: () => call<Note[]>("GET", "/notes"),
  addNote: (text: string) => call<Note>("POST", "/notes", { text }),
}
