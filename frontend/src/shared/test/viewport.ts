import { act } from '@testing-library/react'
import { NARROW_QUERY } from '@/shared/lib/narrow-viewport'

/**
 * 휴대폰 폭(560px 미만)을 흉내 낸다. setup 의 matchMedia 는 늘 넓은 화면이라, 좁은 화면 테스트는 이것으로 바꿔 끼운다.
 * `resize` 는 폭이 560 경계를 넘은 것처럼 change 를 알린다
 */
export function stubViewport(narrow: boolean) {
  let matches = narrow
  const listeners = new Set<EventListenerOrEventListenerObject>()
  vi.stubGlobal('matchMedia', ((query) => ({
    matches: query === NARROW_QUERY ? matches : query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener)
    },
    dispatchEvent: () => true,
  })) satisfies typeof window.matchMedia)
  return {
    resize(next: boolean) {
      matches = next
      act(() => {
        const change = new Event('change')
        for (const listener of listeners) {
          if (typeof listener === 'function') listener(change)
          else listener.handleEvent(change)
        }
      })
    },
  }
}
