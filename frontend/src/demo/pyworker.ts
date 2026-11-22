/// <reference lib="webworker" />
// 웹 시연판: 현장 서버(backend/app · FastAPI · AI 에이전트 · 모델 6개)를 이 작업자 안 Pyodide 에서 그대로 실행.
// 화면 -> /api 요청 · /api/ws 연결을 postMessage 로 받아 backend/app/webdemo.py 의 ASGI 어댑터에 넘김.
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/"
const PACKAGES = ["numpy", "scipy", "scikit-learn", "joblib", "sqlalchemy", "sqlite3", "pydantic", "micropip", "anyio", "sniffio", "idna", "annotated-types", "typing-extensions"]

type Msg =
  | { type: "http"; id: number; method: string; path: string; query: string; headers: [string, string][]; body: ArrayBuffer | null }
  | { type: "ws-open"; cid: number; query: string }
  | { type: "ws-send"; cid: number; text: string }
  | { type: "ws-close"; cid: number }

/* eslint-disable @typescript-eslint/no-explicit-any */
let py: any
let web: any
const post = (m: unknown, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, transfer)
const step = (n: number) => post({ type: "progress", step: n })

async function boot() {
  step(1)
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`)
  py = await loadPyodide({ indexURL: PYODIDE })
  step(2)
  await py.loadPackage(PACKAGES, { messageCallback: () => {} })
  step(3)
  const base = new URL("/py/", self.location.origin).href
  const man = await (await fetch(`${base}manifest.json`, { cache: "no-cache" })).json()
  const micropip = py.pyimport("micropip")
  await micropip.install.callKwargs(man.wheels.map((w: string) => `${base}wheels/${w}`), { deps: false })
  const zip = await (await fetch(`${base}${man.app}`, { cache: "no-cache" })).arrayBuffer()
  py.unpackArchive(zip, "zip", { extractDir: "/home/pyodide/wavespot" })
  py.runPython(`
import os, sys
sys.path.insert(0, "/home/pyodide/wavespot")
os.environ["WAVESPOT_ARTIFACTS_DIR"] = "/home/pyodide/wavespot/artifacts"
`)
  step(4)
  web = py.pyimport("app.webdemo")
  await web.start()
  post({ type: "ready" })
}

const ready = boot().catch((e) => {
  post({ type: "error", message: String(e?.message ?? e).slice(-600) })
  throw e
})

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data
  try {
    await ready
  } catch {
    return
  }
  if (m.type === "http") {
    try {
      const r = await web.http(m.method, m.path, m.query, py.toPy(m.headers), m.body ? new Uint8Array(m.body) : null)
      const body: Uint8Array = r.get("body").toJs()
      const headers: [string, string][] = r.get("headers").toJs()
      const status: number = r.get("status")
      r.destroy()
      post({ type: "http", id: m.id, status, headers, body }, [body.buffer as ArrayBuffer])
    } catch (err) {
      const body = new TextEncoder().encode(JSON.stringify({ detail: `시연 서버 오류: ${String(err).slice(-300)}` }))
      post({ type: "http", id: m.id, status: 500, headers: [["content-type", "application/json"]], body }, [body.buffer])
    }
  } else if (m.type === "ws-open") {
    web.ws_open(m.cid, (cid: number, kind: string, val: unknown) => post({ type: "ws", cid, kind, val: val ?? null }), m.query)
  } else if (m.type === "ws-send") {
    web.ws_send(m.cid, m.text)
  } else if (m.type === "ws-close") {
    web.ws_close(m.cid)
  }
}
