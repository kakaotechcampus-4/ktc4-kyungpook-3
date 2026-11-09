import { act } from '@testing-library/react'
import { NARROW_QUERY } from '@/shared/lib/narrow-viewport'

/**
 * 좁은 폭을 흉내 낸다. 기본은 560px 미만(`NARROW_QUERY`)이고, 768px 미만 휴대폰 배치는 `COMPACT_QUERY` 를 넘긴다.
 * setup 의 matchMedia 는 늘 넓은 화면이라, 좁은 화면 테스트는 이것으로 바꿔 끼운다.
 * `resize` 는 폭이 그 경계를 넘은 것처럼 change 를 알린다
 */
export function stubViewport(narrow: boolean, query: string = NARROW_QUERY) {
  let matches = narrow
  const listeners = new Set<EventListenerOrEventListenerObject>()
  vi.stubGlobal('matchMedia', ((asked) => ({
    matches: asked === query ? matches : asked === '(prefers-reduced-motion: reduce)',
    media: asked,
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
