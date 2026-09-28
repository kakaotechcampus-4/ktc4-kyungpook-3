import { HttpResponse, http } from 'msw'
import { STALE_TIME } from '@/shared/api/queryClient'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { fetchSession, sessionQueryOptions } from './session'

describe('fetchSession', () => {
  it('세션을 Session 으로 돌려준다', async () => {
    await expect(fetchSession()).resolves.toMatchObject({
      user: { id: 'us_01', name: '최진호' },
      lastWorkspaceId: 'ws_01',
    })
  })

  it('401 은 비로그인이라 null 이다', async () => {
    db.authenticated = false
    await expect(fetchSession()).resolves.toBeNull()
  })

  it('네트워크 실패는 비로그인이 아니라 오류다', async () => {
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.error()))
    await expect(fetchSession()).rejects.toMatchObject({ kind: 'network' })
  })

  it('5xx 도 비로그인이 아니라 오류다', async () => {
    server.use(http.get('/api/v1/auth/me', () => fail('INTERNAL_ERROR', 'boom', 500)))
    await expect(fetchSession()).rejects.toMatchObject({ kind: 'http', status: 500 })
  })

  it('세션은 5분 동안 최신이다', () => {
    expect(sessionQueryOptions().staleTime).toBe(STALE_TIME.long)
  })
})
