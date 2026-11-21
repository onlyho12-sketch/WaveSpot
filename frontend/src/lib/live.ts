// 서버 실시간 상태 (WebSocket 하나로 받아 화면 전체가 공유)
import { useSyncExternalStore } from "react"
import { api, type AgentEvent, type Clock, type Handheld, type SearchRequest, type Stats, type Status, type TrackedDevice } from "./api"

export type Live = {
  connected: boolean
  status: Status | null
  clock: Clock | null
  devices: TrackedDevice[]
  requests: Record<number, SearchRequest>
  events: AgentEvent[]
  handheld: Record<number, Handheld>
  stats: Stats | null
}

let state: Live = { connected: false, status: null, clock: null, devices: [], requests: {}, events: [], handheld: {}, stats: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<Live>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

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
