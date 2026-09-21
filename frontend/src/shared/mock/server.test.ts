import { server } from './server'
import { fail } from './envelope'
import { http } from 'msw'
import { fetchDto } from '@/shared/test/api'

it('fails unhandled HTTP requests instead of silently calling the real backend', async () => {
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await expect(fetch(`${location.origin}/api/v1/_m1-unhandled`)).rejects.toThrow(/Cannot bypass/)
  } finally {
    errorLog.mockRestore()
  }
})

it('allows a per-test error override with its code, status and details', async () => {
  server.use(
    http.get('/api/v1/tasks', () =>
      fail('FORBIDDEN', '접근 권한이 없습니다.', 403, { workspace_id: 'ws_01' }),
    ),
  )
  await expect(fetchDto('/tasks?workspace_id=ws_01')).rejects.toMatchObject({
    code: 'FORBIDDEN',
    status: 403,
    details: { workspace_id: 'ws_01' },
  })
})
