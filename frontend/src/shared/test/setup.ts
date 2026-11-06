import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { server } from '@/shared/mock/server'
import { resetDb } from '@/shared/mock/db'
import { clearUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { toast } from '@/shared/ui/toast'

// 파일의 첫 앱 렌더는 lazy 경로를 처음 변환하느라 전체 실행 부하에서 1초(기본값)를 넘길 때가 있다.
// 기다리는 조건은 그대로 두고 한도만 늘린다 — 따로 한도를 준 곳은 그 값을 쓴다
configure({ asyncUtilTimeout: 3000 })

// jsdom 에는 ResizeObserver 가 없다. Radix 체크박스는 form 안에서 숨은 input 의 크기를 재려고 쓴다 —
// 재지 않는 빈 구현으로 둔다. 크기 변화를 보는 테스트는 vi.stubGlobal 로 바꿔 끼운다
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// jsdom 에는 포인터 캡처와 scrollIntoView 가 없다. Radix Select 는 트리거를 누를 때 캡처를 풀고,
// 목록을 열 때 고른 줄을 보이게 굴린다 — 아무것도 하지 않는 구현으로 둔다
if (!Reflect.has(Element.prototype, 'hasPointerCapture')) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
}
if (!Reflect.has(Element.prototype, 'scrollIntoView')) {
  Element.prototype.scrollIntoView = () => {}
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))

beforeEach(() => {
  const matchMedia: typeof window.matchMedia = (query) => ({
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  })

  vi.stubGlobal('matchMedia', matchMedia)
})

afterEach(() => {
  server.resetHandlers()
  resetDb()
  // Zustand store 는 모듈과 함께 살아남는다. 전역 UI 상태도 테스트마다 비운다
  clearUnsavedChanges()
  toast.clear()
  // 알림 띠를 닫은 기록처럼 기기에 남기는 값이 다음 테스트로 새지 않게 한다
  window.localStorage.clear()
})
afterAll(() => server.close())
