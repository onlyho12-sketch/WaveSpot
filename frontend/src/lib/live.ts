// 서버 실시간 상태 (WebSocket 하나로 받아 화면 전체가 공유)
import { useSyncExternalStore } from "react"
import { api, ApiError, type AgentEvent, type Clock, type Handheld, type SearchRequest, type Stats, type Status, type TrackedDevice } from "./api"

/** 수색 결과 이중 저장: 서버가 저장을 확인해 주지 않으면 태블릿에 먼저 두고 연결되면 보냄 (v11 10장) */
export type PendingResult = { id: number; body: { found: boolean; seat?: number | null; note?: string }; at: number }

export type Live = {
  connected: boolean
  outbox: PendingResult[]
  resynced: number | null // 다시 연결된 뒤 다시 받은 알림 수 (잠깐 표시)
  status: Status | null
  clock: Clock | null
  devices: TrackedDevice[]
  requests: Record<number, SearchRequest>
  events: AgentEvent[]
  handheld: Record<number, Handheld>
  stats: Stats | null
}

function loadOutbox(): PendingResult[] {
  try {
    return JSON.parse(localStorage.getItem("wavespot.outbox") ?? "[]")
  } catch {
    return []
  }
}

let state: Live = { connected: false, outbox: loadOutbox(), resynced: null, status: null, clock: null, devices: [], requests: {}, events: [], handheld: {}, stats: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<Live>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function saveOutbox(o: PendingResult[]) {
  set({ outbox: o })
  try {
    localStorage.setItem("wavespot.outbox", JSON.stringify(o))
  } catch {
    /* 저장소를 못 써도 화면 안에서는 대기열 유지 */
  }
}

/** 결과 보내기. 서버에 닿지 않거나 저장 확인이 없으면(5xx) 태블릿 대기열에 두고 queued 로 알려 줌 */
export async function sendResult(id: number, body: PendingResult["body"]): Promise<{ queued: boolean; req?: SearchRequest }> {
  try {
    const req = await api.result(id, body)
    patchRequest(req)
    return { queued: false, req }
  } catch (e) {
    if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) {
      saveOutbox([...state.outbox.filter((p) => p.id !== id), { id, body, at: Date.now() }])
      return { queued: true }
    }
    throw e
  }
}

let flushing = false
export async function flushOutbox() {
  if (flushing || state.outbox.length === 0) return
  flushing = true
  try {
    for (const p of [...state.outbox]) {
      try {
        patchRequest(await api.result(p.id, p.body))
        saveOutbox(state.outbox.filter((x) => x.id !== p.id))
      } catch (e) {
        // 이미 입력된 요청(409) · 없는 요청(404)은 대기열에서 뺌, 나머지는 다음에 다시
        if (e instanceof ApiError && (e.status === 409 || e.status === 404)) saveOutbox(state.outbox.filter((x) => x.id !== p.id))
        else break
      }
    }
  } finally {
    flushing = false
  }
}
setInterval(() => void flushOutbox(), 5000)

let ws: WebSocket | null = null
let sessionId: number | null = null

async function reload() {
  const [requests, events] = await Promise.all([api.requests().catch(() => []), api.events().catch(() => [])])
  set({ requests: Object.fromEntries(requests.map((r) => [r.id, r])), events: events.reverse(), devices: [], handheld: {} })
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws"
  ws = new WebSocket(`${proto}://${location.host}/api/ws`)
  ws.onopen = () => {
    set({ connected: true })
    void reload() // 처음 연결 · 다시 연결될 때 놓친 요청과 기록을 채움
    void flushOutbox()
  }
  ws.onclose = () => {
    set({ connected: false })
    setTimeout(connect, 1500)
  }
  ws.onmessage = (m) => {
    const { type, data } = JSON.parse(m.data)
    switch (type) {
      case "status": {
        const s = data as Status
        if (s.session?.id !== sessionId) {
          sessionId = s.session?.id ?? null
          void reload()
        }
        set({ status: s, clock: s.clock, stats: s.stats })
        break
      }
      case "stats":
        set({ stats: data })
        break
      case "resync": // 끊긴 동안 놓친 알림 수 (기록은 reload 로 다시 받음)
        set({ resynced: data.missed })
        setTimeout(() => set({ resynced: null }), 8000)
        break
      case "clock":
        set({ clock: data })
        if (state.status?.session && data.state !== state.status.session.state)
          set({ status: { ...state.status, session: { ...state.status.session, state: data.state } } })
        break
      case "devices":
        set({ devices: data })
        break
      case "request":
        set({ requests: { ...state.requests, [data.id]: data } })
        break
      case "event":
        set({ events: [...state.events, data].slice(-400) })
        break
      case "handheld": {
        const prev = state.handheld[data.request_id] ?? { step: null, done: null }
        const next: Handheld = data.done ? { ...prev, done: data } : { step: data, done: null }
        set({ handheld: { ...state.handheld, [data.request_id]: next } })
        break
      }
    }
  }
}

setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 20000)
connect()

export function useLive<T>(pick: (s: Live) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => pick(state),
  )
}

export const patchRequest = (r: SearchRequest) => set({ requests: { ...state.requests, [r.id]: r } })
export const patchStatus = (s: Status) => set({ status: s, clock: s.clock })
