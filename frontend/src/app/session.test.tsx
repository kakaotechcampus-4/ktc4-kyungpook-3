import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { sessionQueryOptions } from '@/entities/user'
import { workspaceListQueryOptions } from '@/entities/workspace'
import { workspaceKey } from '@/shared/api/queryKeys'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

describe('세션', () => {
  it('최초 /auth/me 의 401 은 비로그인이다 — 로그인 화면으로 가고 세션을 다시 묻지 않는다', async () => {
    db.authenticated = false
    const log = recordRequests()
    const app = renderApp('/workspaces/ws_01/dashboard')

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
    expect(app.queryClient.getQueryData(sessionQueryOptions().queryKey)).toBeNull()
    expect(log.started.filter(({ path }) => path === '/auth/me')).toHaveLength(1)
  })

  it('인증된 세션이 만료되면 로그인으로 한 번 가고 이전 사용자 데이터를 남기지 않는다', async () => {
    const app = renderApp('/workspaces/ws_01/members')
    expect(await screen.findByText('김서연')).toBeInTheDocument()

    db.authenticated = false
    // 목 GET /members 는 인증을 보지 않는다. handler 는 고치지 않고 이 테스트에서만 401 로 덮는다
    server.use(
      http.get('/api/v1/members', () => fail('UNAUTHENTICATED', '로그인이 필요합니다.', 401)),
    )
    await act(async () => {
      await app.queryClient.invalidateQueries({ queryKey: workspaceKey('ws_01', 'members') })
    })

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    const loginVisits = new Set(
      app
        .visited()
        .filter(({ pathname }) => pathname === '/login')
        .map(({ key }) => key),
    )
    expect(loginVisits.size).toBe(1)
    expect(screen.queryByText('김서연')).toBeNull()
    expect(app.queryClient.getQueryData(workspaceKey('ws_01', 'members'))).toBeUndefined()
    expect(app.queryClient.getQueryData(workspaceListQueryOptions().queryKey)).toBeUndefined()
    expect(app.queryClient.getQueryData(sessionQueryOptions().queryKey)).toBeNull()
  })

  it('세션 조회의 네트워크 실패는 로그아웃이 아니다 — 다시 시도로 이어 간다', async () => {
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.error()))
    const user = userEvent.setup()
    const app = renderApp('/workspaces/ws_01/dashboard')

    // 1초 뒤 한 번 더 시도한 다음에 안내가 뜬다
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert).toHaveTextContent('네트워크에 연결할 수 없어요')
    await app.expectPath('/workspaces/ws_01/dashboard')

    server.resetHandlers()
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('heading', { name: '대시보드' })).toBeInTheDocument()
  })

  it('워크스페이스를 옮기면 이전 공간의 데이터를 보여 주지 않는다', async () => {
    db.workspaces.push({
      workspace_id: 'ws_03',
      name: '세 번째 팀',
      role: 'pm',
      created_at: '2026-09-03T00:00:00Z',
      onboarding: { completed: true, current_step: null, steps: [] },
    })
    db.accounts[0].workspaceIds.push('ws_03')
    db.members.push({
      member_id: 'mb_90',
      workspace_id: 'ws_03',
      display_name: '새 팀원',
      discord_user_id: null,
      notion_name: null,
      role: 'pm',
      created_at: '2026-09-03T00:00:00Z',
    })
    const ws03Members = deferred()
    // ws_03 의 팀원 응답만 붙잡아 둔다. 반환값이 없으면 기본 handler 가 이어 받는다
    server.use(
      http.get('/api/v1/members', async ({ request }) => {
        if (new URL(request.url).searchParams.get('workspace_id') === 'ws_03') {
          await ws03Members.promise
        }
      }),
    )
    const app = renderApp('/workspaces/ws_01/members')
    expect(await screen.findByText('김서연')).toBeInTheDocument()

    act(() => app.navigate('/workspaces/ws_03/members'))
    expect(screen.queryByText('김서연')).toBeNull()

    ws03Members.resolve()
    expect(await screen.findByText('새 팀원')).toBeInTheDocument()
    expect(screen.queryByText('김서연')).toBeNull()
  })
})
