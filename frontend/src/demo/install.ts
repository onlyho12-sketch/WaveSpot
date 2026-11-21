// 웹 시연판 (VITE_DEMO=1 로 빌드할 때만 동작 · Vercel 정적 배포)
// 현장 서버를 브라우저 안(pyworker.ts · Pyodide)에서 돌리고, 화면의 /api 요청과 /api/ws 연결을 그쪽으로 돌림.
// 화면 코드(api.ts · live.ts)는 현장 서버에 붙을 때와 똑같이 동작함.
const DEMO = import.meta.env.VITE_DEMO === "1"

const STEPS = ["실행 환경 받기 (Python · WebAssembly)", "AI 라이브러리 받기 (scikit-learn 등)", "현장 서버 코드 · 모델 파일 받기", "AI 모델 6개 불러오기 · 시험 교시 준비"]

function overlay() {
  const el = document.createElement("div")
  el.setAttribute("role", "status")
  el.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:16px;background:#f4f6f9;font-family:Pretendard,system-ui,sans-serif;color:#0f172a;transition:opacity .3s"
  el.innerHTML = `
    <div style="width:min(440px,100%);background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px 24px 20px;box-shadow:0 8px 24px rgba(15,23,42,.06)">
      <div style="display:flex;align-items:center;gap:12px">
        <img src="/icon.png" alt="" width="40" height="40" style="border-radius:10px"/>
        <div>
          <div style="font-size:18px;font-weight:700">WaveSpot 시연 준비 중</div>
          <div style="font-size:13px;color:#64748b;margin-top:2px">처음 한 번 30초~1분 걸립니다 · 다음부터는 더 빨라요</div>
        </div>
      </div>
      <p style="font-size:14px;line-height:1.6;color:#334155;margin:16px 0 14px">현장 서버(AI 에이전트 · AI 모델 6개)를 이 브라우저 안에서 그대로 실행합니다. 설치나 로그인은 필요 없습니다.</p>
      <ol data-steps style="list-style:none;margin:0;padding:0;display:grid;gap:8px;font-size:14px"></ol>
      <div data-err style="display:none;margin-top:14px;font-size:13px;color:#b91c1c;line-height:1.5"></div>
    </div>`
  const ol = el.querySelector<HTMLOListElement>("[data-steps]")!
  const render = (cur: number) => {
    ol.innerHTML = STEPS.map((s, i) => {
      const n = i + 1
      const done = n < cur
      const now = n === cur
      const dot = done
        ? `<span style="width:20px;height:20px;border-radius:50%;background:#16a34a;color:#fff;display:grid;place-items:center;font-size:12px">✓</span>`
        : `<span style="width:20px;height:20px;border-radius:50%;border:2px solid ${now ? "#2563eb" : "#cbd5e1"};display:grid;place-items:center;font-size:11px;color:${now ? "#2563eb" : "#94a3b8"};font-weight:700">${n}</span>`
      return `<li style="display:flex;align-items:center;gap:10px;color:${done ? "#64748b" : now ? "#0f172a" : "#94a3b8"};font-weight:${now ? 600 : 400}">${dot}${s}</li>`
    }).join("")
  }
  render(1)
  const mount = () => document.body.appendChild(el)
  if (document.body) mount()
  else document.addEventListener("DOMContentLoaded", mount)
  return {
    step: render,
    done: () => {
      el.style.opacity = "0"
      setTimeout(() => el.remove(), 300)
    },
    fail: (msg: string) => {
      const err = el.querySelector<HTMLDivElement>("[data-err]")!
      err.style.display = "block"
      err.innerHTML = `시연 서버를 시작하지 못했습니다. 인터넷 연결을 확인하고 <a href="" style="color:#2563eb">새로고침</a>해 주세요.<br/><span style="color:#94a3b8">${msg.replace(/</g, "&lt;")}</span>`
    },
  }
}

function install() {
  const ui = overlay()
  const worker = new Worker(new URL("./pyworker.ts", import.meta.url), { type: "module" })
  let markReady!: () => void
  const ready = new Promise<void>((r) => (markReady = r))
  const pending = new Map<number, (m: { status: number; headers: [string, string][]; body: Uint8Array }) => void>()
  const sockets = new Map<number, DemoSocket>()
  let seq = 0

  worker.onmessage = (e) => {
    const m = e.data
    if (m.type === "progress") ui.step(m.step)
    else if (m.type === "ready") {
      markReady()
      ui.done()
    } else if (m.type === "error") ui.fail(m.message)
    else if (m.type === "http") {
      pending.get(m.id)?.(m)
      pending.delete(m.id)
    } else if (m.type === "ws") sockets.get(m.cid)?._emit(m.kind, m.val)
  }
  worker.onerror = (e) => ui.fail(e.message || "작업자 오류")

  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    const url = new URL(href, location.href)
    if (url.origin !== location.origin || !url.pathname.startsWith("/api")) return realFetch(input, init)
    const req = new Request(url, init ?? (input instanceof Request ? input : undefined))
    const body = req.method === "GET" || req.method === "HEAD" ? null : await req.arrayBuffer()
    await ready
    const id = ++seq
    return new Promise<Response>((resolve) => {
      pending.set(id, (r) => resolve(new Response(r.status === 204 || r.status === 304 ? null : (r.body as BodyInit), { status: r.status, headers: r.headers })))
      worker.postMessage({ type: "http", id, method: req.method, path: url.pathname, query: url.search.slice(1), headers: [...req.headers.entries()], body }, body ? [body] : [])
    })
  }

  class DemoSocket extends EventTarget {
    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3
    readyState = 0
    url: string
    onopen: ((e: Event) => void) | null = null
    onmessage: ((e: MessageEvent) => void) | null = null
    onclose: ((e: CloseEvent) => void) | null = null
    onerror: ((e: Event) => void) | null = null
    private cid = ++seq
    constructor(url: string) {
      super()
      this.url = url
      sockets.set(this.cid, this)
      void ready.then(() => worker.postMessage({ type: "ws-open", cid: this.cid }))
    }
    send(text: string) {
      if (this.readyState === 1) worker.postMessage({ type: "ws-send", cid: this.cid, text })
    }
    close() {
      if (this.readyState >= 2) return
      this.readyState = 3
      worker.postMessage({ type: "ws-close", cid: this.cid })
      this._emit("close", 1000)
    }
    _emit(kind: string, val: unknown) {
      if (kind === "open") {
        this.readyState = 1
        const ev = new Event("open")
        this.onopen?.(ev)
        this.dispatchEvent(ev)
      } else if (kind === "message") {
        const ev = new MessageEvent("message", { data: val })
        this.onmessage?.(ev)
        this.dispatchEvent(ev)
      } else if (kind === "close") {
        if (!sockets.has(this.cid)) return
        sockets.delete(this.cid)
        this.readyState = 3
        const ev = new CloseEvent("close", { code: Number(val) || 1000 })
        this.onclose?.(ev)
        this.dispatchEvent(ev)
      }
    }
  }

  window.WebSocket = new Proxy(window.WebSocket, {
    construct(target, args: [string | URL, (string | string[])?]) {
      const u = String(args[0])
      if (u.includes("/api/ws")) return new DemoSocket(u) as unknown as WebSocket
      return new target(...args)
    },
  })
}

if (DEMO) install()

export {}
