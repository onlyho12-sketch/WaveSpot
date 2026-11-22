// 증거 신뢰성 · 장애 기록 패널 (설계안 v11 10장) · 기록 화면과 관리 화면이 함께 씀
// - 기록 위변조 확인: 해시 체인을 다시 계산 · 마지막 값은 시험 종료 때 감독관 확인서에 적어 따로 보관
// - 장애 · 복구 기록: 시간순 · 복구에 걸린 시간 vs 목표 · 놓친 측정값 → 이의 제기 때 '그 시각 장비가 정상이었나' 설명
import { useQuery } from "@tanstack/react-query"
import { Download, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Panel, Status, Tag } from "@/components/ui/status"
import { api, type FaultRecord } from "@/lib/api"
import { useLive } from "@/lib/live"
import { cn } from "@/lib/utils"

/** 해시 앞 8자리 · 뒤 8자리 (확인서에 옮겨 적기 쉽게 4자씩 띄움) */
const shortHash = (h: string) => `${h.slice(0, 4)} ${h.slice(4, 8)} … ${h.slice(-8, -4)} ${h.slice(-4)}`

export function ChainPanel({ sessionId }: { sessionId: number | null }) {
  const events = useLive((s) => s.events.length)
  const q = useQuery({ queryKey: ["chain", sessionId], queryFn: api.verifyChain, enabled: sessionId != null })
  const [busy, setBusy] = useState(false)
  const [exportErr, setExportErr] = useState<string | null>(null)
  const v = q.data
  const stale = v && events > 0 && v.count < events // 새 기록이 쌓였는데 아직 다시 확인 안 함

  async function download() {
    setBusy(true)
    setExportErr(null)
    try {
      const blob = await api.exportReport()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `wavespot_report_${sessionId}.json`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="기록 위변조 확인" aside={
      <Button size="sm" variant="subtle" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw className={cn(q.isFetching && "animate-spin")} />다시 확인</Button>
    }>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-4 medium:px-5">
        {!v ? (
          <p className="text-sm text-fg-3">{q.isError ? (q.error as Error).message : "확인 중…"}</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              {v.ok ? <ShieldCheck className="size-8 text-fg-3" /> : <ShieldAlert className="size-9 text-danger" />}
              <div>
                <div className={cn("text-fs17 font-bold", v.ok ? "text-fg" : "text-danger")}>{v.ok ? "고친 흔적 없음" : "기록이 바뀌었습니다"}</div>
                <div className="num text-fs13 text-fg-3">기록 {v.count.toLocaleString()}건. 판단, 결과, 의견마다 앞 기록과 연결한 해시로 확인</div>
              </div>
            </div>
            {v.last_hash && (
              <div className="min-w-0">
                <div className="text-fs12 font-semibold text-fg-3">마지막 값 (시험 종료 때 감독관 확인서에 적어 둡니다)</div>
                <div className="num mt-0.5 font-mono text-fs17 font-bold tracking-wide" title={v.last_hash}>{shortHash(v.last_hash)}</div>
              </div>
            )}
            <div className="ml-auto flex flex-col items-end gap-1">
              <Button variant="secondary" onClick={download} disabled={busy || sessionId == null}><Download />리포트 내보내기</Button>
              {exportErr && <span role="alert" className="text-xs text-danger">{exportErr}</span>}
            </div>
          </>
        )}
      </div>
      {v && !v.ok && v.broken && (
        <p role="alert" className="border-t border-line bg-danger-soft px-5 py-2.5 text-sm font-semibold text-danger">
          {v.broken.seq ? `${v.broken.seq}번째 기록부터 ` : ""}{v.broken.reason}. 이의 제기 때 이 리포트는 증거로 쓰기 어렵습니다.
        </p>
      )}
      {stale && v?.ok && <p className="border-t border-line px-5 py-2 text-fs13 text-fg-3">확인 뒤 새 기록이 쌓였습니다. 시험이 끝나면 다시 확인하세요.</p>}
    </Panel>
  )
}

const took = (f: FaultRecord) => {
  if (f.ended == null) return { text: "진행 중", tone: "danger" as const }
  const s = f.recover_sec ?? f.ended - f.started
  const t = s >= 60 ? `${Math.floor(s / 60)}분 ${Math.round(s % 60)}초` : `${Math.round(s)}초`
  if (f.target_sec == null) return { text: t, tone: "neutral" as const }
  return { text: `${t} / 목표 ${f.target_sec}초`, tone: s <= f.target_sec ? ("ok" as const) : ("danger" as const) }
}

/** 장애 · 복구 기록 (시간순) */
export function FaultLog({ sessionId, title = "장애 및 복구 기록", detail = false }: { sessionId: number | null; title?: string; detail?: boolean }) {
  const active = useLive((s) => s.status?.health?.active.length ?? 0)
  const events = useLive((s) => s.events.filter((e) => e.stage === "장비").length)
  const q = useQuery({ queryKey: ["faults", sessionId, active, events], queryFn: api.faults, enabled: sessionId != null })
  const rows = q.data?.records ?? []
  return (
    <Panel title={<>{title} <span className="num font-medium text-fg-3">{rows.length}</span></>}>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-fg-3">장애 없음. 장비가 계속 정상이었습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="border-b border-line bg-subtle text-left text-xs text-fg-3">
              <tr>
                <th className="w-28 px-4 py-2 font-semibold">시각</th>
                <th className="py-2 font-semibold">장애</th>
                {detail && <th className="py-2 font-semibold">자동 대응</th>}
                <th className="px-4 py-2 font-semibold">복구까지</th>
                <th className="py-2 pr-4 text-right font-semibold">실시간 판단에 못 쓴 측정값</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((f) => {
                const t = took(f)
                return (
                  <tr key={f.id}>
                    <td className="num px-4 py-2.5 whitespace-nowrap text-fg-2">{f.clock.slice(0, 5)}{f.end_clock ? ` ~ ${f.end_clock.slice(0, 5)}` : ""}</td>
                    <td className="py-2.5">
                      <span className="font-semibold">{f.title}</span>
                      {f.injected && <Tag className="ml-2">훈련</Tag>}
                    </td>
                    {detail && <td className="py-2.5 pr-3 text-fs13 text-fg-2">{f.action}</td>}
                    <td className="px-4 py-2.5 whitespace-nowrap"><Status tone={t.tone}><span className="num">{t.text}</span></Status></td>
                    <td className="num py-2.5 pr-4 text-right">{f.missed ? `${f.missed.toLocaleString()}건 (수신기에 저장 후 동기화)` : "-"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}
