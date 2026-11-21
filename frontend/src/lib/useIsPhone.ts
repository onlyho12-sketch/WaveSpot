// 휴대폰 폭(600px 미만, Material 3 compact) 여부 · 화면 구조 자체가 달라지는 곳에서만 사용 (나머지는 CSS 폭 구분)
import { useSyncExternalStore } from "react"

const q = "(max-width: 599.98px)"
export function useIsPhone() {
  return useSyncExternalStore(
    (l) => {
      const m = window.matchMedia(q)
      m.addEventListener("change", l)
      return () => m.removeEventListener("change", l)
    },
    () => window.matchMedia(q).matches,
  )
}
