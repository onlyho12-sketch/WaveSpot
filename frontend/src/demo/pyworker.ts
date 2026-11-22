/// <reference lib="webworker" />
// 웹 시연판: 현장 서버(backend/app · FastAPI · AI 에이전트 · 모델 6개)를 이 작업자 안 Pyodide 에서 그대로 실행.
// 화면 -> /api 요청 · /api/ws 연결을 postMessage 로 받아 backend/app/webdemo.py 의 ASGI 어댑터에 넘김.
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/"
// micropip 없이 휠(순수 Python)을 바로 풀어 넣으므로 micropip 은 받지 않음
const PACKAGES = ["numpy", "scipy", "scikit-learn", "joblib", "sqlalchemy", "sqlite3", "pydantic", "anyio", "sniffio", "idna", "annotated-types", "typing-extensions"]

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
  // 서버 코드 · 모델(app.zip)과 휠은 Python 실행 환경 · 라이브러리와 동시에 받음 (차례로 받으면 그만큼 더 기다림)
  const base = new URL("/py/", self.location.origin).href
  const get = (url: string) => fetch(url, { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error(`${url} ${r.status}`)
    return r.arrayBuffer()
  })
  const files = fetch(`${base}manifest.json`, { cache: "no-cache" }).then((r) => r.json()).then((man: { app: string; wheels: string[] }) =>
    Promise.all([get(`${base}${man.app}`), ...man.wheels.map((w) => get(`${base}wheels/${w}`))]))
  files.catch(() => {}) // 실패는 아래 await 에서 처리
  const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE}pyodide.mjs`)
  py = await loadPyodide({ indexURL: PYODIDE })
  step(2)
  await py.loadPackage(PACKAGES, { messageCallback: () => {} })
  step(3)
  const [zip, ...wheels] = await files
  // 휠은 순수 Python zip 이라 site-packages 에 그대로 풀면 설치와 같음
  const site: string = py.runPython("import site; site.getsitepackages()[0]")
  for (const w of wheels) py.unpackArchive(w, "zip", { extractDir: site })
  py.unpackArchive(zip, "zip", { extractDir: "/home/pyodide/wavespot" })
  py.runPython(`
import importlib, os, sys
importlib.invalidate_caches()
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
