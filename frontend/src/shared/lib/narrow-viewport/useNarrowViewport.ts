import { useSyncExternalStore } from 'react'

/** 휴대폰 폭. 560px 부터는 넓은 화면이다 — 소수 픽셀 폭(확대 배율)에서 559 와 560 사이가 비지 않게 559.98 로 잰다 */
export const NARROW_QUERY = '(max-width: 559.98px)'

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(NARROW_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function isNarrow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches
}

/** 지금 폭이 휴대폰 폭인가. 폭이 560 경계를 넘으면 다시 그린다. matchMedia 가 없으면 넓은 화면이다 */
export function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, isNarrow, () => false)
}
