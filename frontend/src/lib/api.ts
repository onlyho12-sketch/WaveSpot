// 백엔드 REST 와 데이터 형식 (backend/app/models.py · agent.py 와 맞춤)

export type Evidence = { label: string; value: string; source: string; points: number | null }

export type Level = 0 | 1 | 2 | 3 | 4

export type SearchRequest = {
  id: number
  device_id: string
  level: 2 | 3 | 4 // 대응 단계 (설계안 '수색 강화 사다리'): 휴대형 접근 · 정밀 수색 · 2차 수색
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
  stage: "준비" | "신호 감지" | "위치 추정" | "수색" | "결과 반영" | "장비" | "보안"
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
  zone: number | null // 수신기 2대 이상 끊김이면 위치 추정 중지 -> null
  zone_prob: number | null
  zone2: number | null
  zone2_prob: number | null
  kind: string
  request_id: number | null
  no_location?: boolean
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
  nodes: Node[]
  beacon_ok: boolean
  allowlist: { device_id: string; label: string }[]
  clock: Clock
  health: Health
  selfcheck: SelfCheck[]
}

// rate 최근 10초 초당 받은 신호 · heard 들린 기기 수 · skew_ms 서버와 시각 차 · fw_ok 펌웨어 서명 · cert_ok 인증서
export type Node = { node_id: string; status: string; last_seen: string | null; rate: number | null; heard: number | null; skew_ms?: number; fw_ok?: boolean; cert_ok?: boolean }

/** 설계안 v11 10장 · 단계적 축소: normal → degraded(수신기 3/4) → no_location(2대 이상 끊김) · recovering(서버 재시작) · manual(망 장애 = 감시 중단) */
export type Health = {
  mode: "normal" | "degraded" | "no_location" | "recovering" | "manual"
  nodes_ok: number
  down: string[]
  beacon: "ok" | "frozen" | "off"
  model_rule: boolean // 모델 오류로 규칙 점수 사용 중
  result_fail: boolean
  locked: boolean // 시험 중 허용 목록 · 기준값 잠금
  local_store: number // 망 장애 동안 수신기 자체 저장분
  checkpoint: string | null // 마지막 상태 저장 시각
  active: { kind: string; title: string; screen: string; since: string; injected: boolean }[]
}

export type SelfCheck = { key: string; label: string; value: string; ok: boolean | null }

export type FaultSpec = { kind: string; title: string; detect: string; action: string; screen: string; target: string; target_sec: number | null }
export type FaultRecord = {
  id: number; kind: string; title: string; action: string; started: number; ended: number | null; clock: string; end_clock: string | null
  target: string | null; target_sec: number | null; recover_sec: number | null; missed: number; injected: boolean
}
export type ChainCheck = { ok: boolean; count: number; last_hash: string | null; last_seq: number; broken: { seq: number | null; kind: string; reason: string } | null; checked_at: string }
export type AccessRow = { id: number; at: string; role: string; role_name: string; method: string; path: string; action: string; status: number; allowed: boolean }

/** 우회 · 해킹 대응 (설계안 v11 10장) · status: done 탐지 구현 · shown 화면 표시 · 운영 절차 · todo 실기기 단계 */
export type AttackSpec = { kind: string; group: "evade" | "hack"; title: string; response: string; limit: string; status: "done" | "shown" | "todo"; replay: boolean }
export type AttackRun = {
  id: number; kind: string; title: string; injected: boolean; started: number; clock: string
  detected_at: number | null; detected_clock: string | null; took: number | null; detail: string | null; device_id: string | null; level: number | null
}
export type AttackView = {
  catalog: AttackSpec[]; runs: AttackRun[]; can_inject: boolean; rejected: number; fingerprints: number
  thresholds: { request: number; caution: number; base_request: number; base_caution: number } | null // 관리자에게만
}

export type Role = "supervisor" | "admin" | "auditor"
export const ROLE_NAME: Record<Role, string> = { supervisor: "감독관", admin: "관리자", auditor: "감사" }

export type Note = { id: number; sim_time: number; clock: string; text: string }

/** by_model: 모델별 에이전트 호출 수 (파이프라인은 모델마다 device_windows 회) · series: 분마다 [경과 분, 에이전트 누적, 파이프라인 누적] */
export type Stats = {
  windows: number; device_windows: number; agent_calls: number; pipeline_calls: number
  by_model?: Record<string, number>; series?: [number, number, number][]
}

// 휴대형 순회: 걸음마다 세기와 '이번 순회 최고값 대비 차이', 끝나면 좌석별 결과
export type HandheldStep = { request_id: number; zone: number; zones?: number[]; zone_index?: number; dwell?: number; level: "far" | "near" | "nearest"; pos_seat: number; pass: number; rssi: number; rel_db: number }
export type HandheldDone = { request_id: number; done: true; best_seat: number | null; seat_medians: Record<string, number> }
export type Handheld = { step: HandheldStep | null; done: HandheldDone | null }

/** 이 기기에서 쓰는 역할 (역할별 권한 · 접근 기록). 프로토타입은 관리 화면에서 바꿈 · 실기기는 로그인으로 */
let role: Role = "supervisor"
try {
  const r = localStorage.getItem("wavespot.role")
  if (r === "admin" || r === "auditor" || r === "supervisor") role = r
} catch {
  /* 저장소를 못 쓰면 감독관 */
}
export const getRole = () => role
export function setRole(r: Role) {
  role = r
  try {
    localStorage.setItem("wavespot.role", r)
  } catch {
    /* 무시 */
  }
}

/** status 0 = 서버에 닿지 않음 (망 · 서버 끊김) */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { "X-WaveSpot-Role": role, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError("서버에 연결할 수 없습니다", 0)
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new ApiError(detail.detail ?? `서버 응답 오류 (${res.status})`, res.status)
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
  faults: () => call<{ catalog: FaultSpec[]; records: FaultRecord[]; can_inject: boolean }>("GET", "/faults"),
  inject: (kind: string) => call<Status>("POST", `/faults/${kind}`),
  attacks: () => call<AttackView>("GET", "/attacks"),
  injectAttack: (kind: string) => call<{ runs: AttackRun[] }>("POST", `/attacks/${kind}`),
  verifyChain: () => call<ChainCheck>("GET", "/chain/verify"),
  access: () => call<AccessRow[]>("GET", "/access?limit=80"),
  exportReport: async () => {
    const res = await fetch("/api/report/export", { headers: { "X-WaveSpot-Role": role } })
    if (!res.ok) throw new ApiError(`내보내기 실패 (${res.status})`, res.status)
    return res.blob()
  },
}
