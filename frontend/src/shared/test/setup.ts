import '@testing-library/jest-dom/vitest'
import { server } from '@/shared/mock/server'
import { resetDb } from '@/shared/mock/db'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetDb()
})
afterAll(() => server.close())
