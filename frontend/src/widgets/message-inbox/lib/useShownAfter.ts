import { useEffect, useState } from 'react'

/**
 * `active` 가 `delayMs` 넘게 이어질 때만 true 다 — 짧게 켜졌다 꺼지는 상태(빠른 저장)를 화면에 번쩍이지 않게 한다.
 * `active` 가 꺼지면 바로 false 다. 끝난 일을 진행 중으로 남겨 두지 않는다(최소 표시 시간을 두지 않는다)
 */
export function useShownAfter(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setShown(true), delayMs)
    return () => {
      clearTimeout(timer)
      setShown(false)
    }
  }, [active, delayMs])
  return active && shown
}
