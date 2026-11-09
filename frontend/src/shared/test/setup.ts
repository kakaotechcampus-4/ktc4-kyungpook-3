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
// 시트는 손잡이를 끄는 동안 포인터를 붙잡는다
if (!Reflect.has(Element.prototype, 'setPointerCapture')) {
  Element.prototype.setPointerCapture = () => {}
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

  // jsdom 에는 requestIdleCallback 이 없어 셸의 「한가할 때 셸 탭 미리 받기」가 짧은 타이머로 돈다 (#536).
  // 화면 테스트는 그 화면 자신의 요청을 단언하므로 기본은 한가해지지 않는 브라우저로 둔다. 미리 받기를 보는 테스트는 바꿔 끼운다.
  // stubGlobal 이 아니라 창에 직접 둔다 — 테스트가 vi.unstubAllGlobals() 로 걷은 뒤 화면이 내려가며 취소를 불러도 남아 있다
  window.requestIdleCallback = () => 0
  window.cancelIdleCallback = () => {}
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
