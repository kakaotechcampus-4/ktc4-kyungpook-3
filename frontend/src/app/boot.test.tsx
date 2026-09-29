import { act, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { businessRequests, recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

describe('앱 부팅', () => {
  it('/auth/me 가 끝나기 전에 /workspaces 도 시작한다', async () => {
    const session = deferred()
    server.use(
      http.get('/api/v1/auth/me', async () => {
        await session.promise
        return ok(db.session)
      }),
    )
    const log = recordRequests()
    renderApp('/workspaces/ws_01/dashboard')

    await waitFor(() =>
      expect(log.started.map(({ path }) => path)).toEqual(
        expect.arrayContaining(['/auth/me', '/workspaces']),
      ),
    )
    // 두 요청이 겹쳐 있다 — 세션 응답은 아직 오지 않았다
    expect(log.answered.map(({ path }) => path)).not.toContain('/auth/me')

    session.resolve()
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
  })

  it('가드는 부팅 요청을 다시 만들지 않는다', async () => {
    const log = recordRequests()
    renderApp('/workspaces/ws_01/dashboard')
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()

    expect(log.started.filter(({ path }) => path === '/auth/me')).toHaveLength(1)
    expect(log.started.filter(({ path }) => path === '/workspaces')).toHaveLength(1)
    expect(businessRequests(log.started)).toEqual([])
  })

  it('화면을 옮겨 다녀도 세션과 목록을 다시 부르지 않는다', async () => {
    const log = recordRequests()
    const app = renderApp('/workspaces/ws_01/dashboard')
    await screen.findByRole('heading', { name: '대시보드' })

    act(() => app.navigate('/workspaces/ws_01/settings'))
    expect(await screen.findByRole('heading', { name: '설정' })).toBeInTheDocument()
    expect(
      log.started.filter(({ path }) => path === '/auth/me' || path === '/workspaces'),
    ).toHaveLength(2)
  })
})
