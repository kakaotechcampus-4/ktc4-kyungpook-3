import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { server } from '@/shared/mock/server'
import { resetDb } from '@/shared/mock/db'
import { clearUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { toast } from '@/shared/ui/toast'

// 파일의 첫 앱 렌더는 lazy 경로를 처음 변환하느라 전체 실행 부하에서 1초(기본값)를 넘길 때가 있다.
// 기다리는 조건은 그대로 두고 한도만 늘린다 — 따로 한도를 준 곳은 그 값을 쓴다
configure({ asyncUtilTimeout: 3000 })

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetDb()
  // Zustand store 는 모듈과 함께 살아남는다. 전역 UI 상태도 테스트마다 비운다
  clearUnsavedChanges()
  toast.clear()
})
afterAll(() => server.close())
