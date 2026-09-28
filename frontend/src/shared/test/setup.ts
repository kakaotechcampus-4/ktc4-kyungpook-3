import '@testing-library/jest-dom/vitest'
import { server } from '@/shared/mock/server'
import { resetDb } from '@/shared/mock/db'
import { clearUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { toast } from '@/shared/ui/toast'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetDb()
  // Zustand store 는 모듈과 함께 살아남는다. 전역 UI 상태도 테스트마다 비운다
  clearUnsavedChanges()
  toast.clear()
})
afterAll(() => server.close())
