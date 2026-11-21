// 상태가 바뀌는 순간의 애니메이션을 돕는 훅 (index.css의 animate-* 와 함께 씀)
import { useEffect, useRef, useState } from "react"

const reduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches

/** 값이 바뀐 횟수. 처음 그릴 때는 0이라 화면에 들어올 때마다 재생되지 않음 · key로 써서 애니메이션을 다시 재생 */
export function useChangeCount<T>(value: T) {
  const prev = useRef(value)
  const [n, setN] = useState(0)
  useEffect(() => {
    if (Object.is(prev.current, value)) return
    prev.current = value
    setN((x) => x + 1)
  }, [value])
  return n
}

/** 숫자가 바뀌면 이전 값에서 새 값까지 올라가며(내려가며) 보여 줌. 처음 값은 바로 표시 */
export function useCountUp(value: number, ms = 700) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = from.current
    if (start === value) return
    if (reduced()) {
      from.current = value
      setShown(value)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      const n = Math.round(start + (value - start) * (1 - (1 - p) ** 3))
      from.current = n
      setShown(n)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

/**
 * 요청 카드 · enter: 처음 보는 요청 (내려오며 등장) · flash: 처음 보는 단계면 그 단계 키 (테두리 깜빡임 덮개의 key)
 * 탭을 오가며 다시 그릴 때는 둘 다 꺼져 있어 재생되지 않음
 */
const seenIds = new Set<number>()
const seenLevels = new Set<string>()
export function useFreshRequest(id: number, level: number) {
  const key = `${id}:${level}`
  const [enter] = useState(() => !seenIds.has(id))
  const [flash, setFlash] = useState<string | null>(() => (seenLevels.has(key) ? null : key))
  const last = useRef(key)
  useEffect(() => {
    if (last.current !== key) {
      last.current = key
      if (!seenLevels.has(key)) setFlash(key)
    }
    seenIds.add(id)
    seenLevels.add(key)
  }, [id, key])
  return { enter, flash }
}
