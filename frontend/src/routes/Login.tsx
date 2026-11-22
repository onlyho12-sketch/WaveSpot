// 로그인 · 계정 3개(감독관 · 관리자 · 검토자). 역할은 계정으로 정해지고 화면도 역할별로 다름 (lib/roles.ts)
// 아래 시연용 계정을 누르면 아이디와 비밀번호가 채워짐 (심사 · 시연용)
import { type FormEvent, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { ApiError, login, ROLE_NAME, type Role } from "@/lib/api"
import { ROLE_DESC } from "@/lib/roles"
import { cn } from "@/lib/utils"

const DEMO_PASSWORD = "wavespot2026"
const DEMO: Role[] = ["supervisor", "admin", "auditor"]

export function Login() {
  const [user, setUser] = useState("")
  const [pw, setPw] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitRef = useRef<HTMLButtonElement>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(user.trim(), pw)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "로그인하지 못했습니다")
      setBusy(false)
    }
  }

  function fill(r: Role) {
    setUser(r)
    setPw(DEMO_PASSWORD)
    setError(null)
    submitRef.current?.focus()
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4 py-8">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-4">
          <img src="/icon.png" alt="" className="size-16 rounded-2xl medium:size-[72px]" />
          <div>
            <h1 className="text-fs26 leading-tight font-bold medium:text-[30px]">WaveSpot</h1>
            <p className="mt-0.5 text-fs15 text-fg-3">시험장 반입 금지 기기 감독</p>
          </div>
        </div>

        <form onSubmit={submit} className="rounded-lg border border-line bg-surface p-5">
          <label htmlFor="login-user" className="mb-1.5 block text-fs13 font-semibold text-fg-2">아이디</label>
          <input id="login-user" value={user} onChange={(e) => setUser(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required
            className="h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-fs15 focus:border-brand focus:outline-none" />
          <label htmlFor="login-pw" className="mt-4 mb-1.5 block text-fs13 font-semibold text-fg-2">비밀번호</label>
          <input id="login-pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required
            className="h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-fs15 focus:border-brand focus:outline-none" />
          {error && <p role="alert" className="mt-3 text-fs14 font-semibold text-danger">{error}</p>}
          <Button ref={submitRef} type="submit" className="mt-5 w-full" disabled={busy || !user.trim() || !pw}>
            {busy ? "확인 중…" : "로그인"}
          </Button>
        </form>

        <section aria-labelledby="demo-accounts" className="mt-4 rounded-lg border border-line bg-surface">
          <header className="flex items-baseline gap-2 border-b border-line px-4 py-2.5">
            <h2 id="demo-accounts" className="text-fs14 font-semibold">시연용 계정</h2>
            <span className="text-fs13 text-fg-3">누르면 입력됩니다 · 비밀번호 <span className="num">{DEMO_PASSWORD}</span></span>
          </header>
          <ul className="divide-y divide-line">
            {DEMO.map((r) => (
              <li key={r}>
                <button type="button" onClick={() => fill(r)}
                  className={cn("w-full px-4 py-3 text-left hover:bg-subtle focus-visible:bg-subtle", user === r && "bg-brand-soft/60")}>
                  <span className="flex items-baseline gap-2">
                    <span className="text-fs15 font-semibold">{ROLE_NAME[r]}</span>
                    <span className="num text-fs13 text-fg-3">{r}</span>
                  </span>
                  <span className="mt-0.5 block text-fs13 leading-snug text-fg-2">{ROLE_DESC[r]}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
