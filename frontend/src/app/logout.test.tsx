import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { SESSION_QUERY_KEY } from '@/entities/user'
import { WORKSPACE_LIST_QUERY_KEY } from '@/entities/workspace'
import { LOGOUT_FAILED_MESSAGE } from '@/features/auth'
import { workspaceKey } from '@/shared/api/queryKeys'
import { useUnsavedChangesStore } from '@/shared/lib/unsaved-changes'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/* U2-7. 로그아웃은 서버 성공 뒤에만 캐시를 정리하고 로그인으로 간다 */

/** 로그아웃은 헤더의 계정 메뉴 안에 있다 (U4). 메뉴를 열고 항목을 고른다 */
async function clickLogout() {
  await userEvent.click(screen.getByRole('button', { name: /^내 계정/ }))
  await userEvent.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
}

async function openMembers() {
  const app = renderApp('/workspaces/ws_01/members')
  expect(await screen.findByText('김서연')).toBeInTheDocument()
  return app
}

const logoutPosts = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ method, path }) => method === 'POST' && path === '/auth/logout')

describe('로그아웃 (U2-7)', () => {
  it('서버 성공 → 캐시 정리 → 로그인 이동', async () => {
    const log = recordRequests()
    const app = await openMembers()
    await clickLogout()

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
    expect(db.authenticated).toBe(false)
    expect(logoutPosts(log)).toHaveLength(1)
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toBeNull()
    await waitFor(() =>
      expect(app.queryClient.getQueryData(workspaceKey('ws_01', 'members'))).toBeUndefined(),
    )
    expect(app.queryClient.getQueryData(WORKSPACE_LIST_QUERY_KEY)).toBeUndefined()
    // 이전 사용자의 화면이 로그아웃 뒤에 다시 조회하지 않는다
    const after = log.timeline.indexOf('answer POST /auth/logout')
    expect(log.timeline.slice(after + 1).filter((line) => line.startsWith('start'))).toEqual([])
  })

  it('실패하면 캐시와 화면이 그대로이고 안내가 남는다. 다시 누르면 된다', async () => {
    server.use(
      http.post('/api/v1/auth/logout', () => fail('INTERNAL_ERROR', 'boom', 500), { once: true }),
    )
    const app = await openMembers()
    await clickLogout()

    expect(await screen.findByRole('alert')).toHaveTextContent(LOGOUT_FAILED_MESSAGE)
    await app.expectPath('/workspaces/ws_01/members')
    expect(screen.getByText('김서연')).toBeInTheDocument()
    expect(app.queryClient.getQueryData(SESSION_QUERY_KEY)).toMatchObject({ user: { id: 'us_01' } })
    expect(app.queryClient.getQueryData(workspaceKey('ws_01', 'members'))).toBeDefined()
    expect(app.queryClient.getQueryData(WORKSPACE_LIST_QUERY_KEY)).toHaveLength(2)

    await clickLogout()
    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
  })

  it('저장하지 않은 변경이 있으면 먼저 묻는다 — 계속 작성하면 요청하지 않는다', async () => {
    const log = recordRequests()
    const app = await openMembers()
    useUnsavedChangesStore.getState().mark('test-form')

    await clickLogout()
    expect(
      await screen.findByRole('dialog', { name: '저장하지 않은 변경 내용이 있어요' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '계속 작성하기' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(logoutPosts(log)).toHaveLength(0)
    await app.expectPath('/workspaces/ws_01/members')
    expect(db.authenticated).toBe(true)
  })

  it('변경을 버리고 나가면 로그아웃하고 등록도 풀린다', async () => {
    const log = recordRequests()
    const app = await openMembers()
    useUnsavedChangesStore.getState().mark('test-form')

    await clickLogout()
    await userEvent.click(await screen.findByRole('button', { name: '변경 내용 버리고 나가기' }))

    expect(await screen.findByRole('heading', { name: '로그인' })).toBeInTheDocument()
    await app.expectPath('/login')
    expect(logoutPosts(log)).toHaveLength(1)
    await waitFor(() => expect(useUnsavedChangesStore.getState().sources.size).toBe(0))
  })

  it('로그아웃 뒤 다시 로그인하면 공간 개수 분기로 간다 — 재방문이 아니다', async () => {
    await openMembers()
    await clickLogout()
    await screen.findByRole('heading', { name: '로그인' })

    await userEvent.type(screen.getByLabelText('이메일'), 'pm@example.com')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'mock-password')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('heading', { name: '워크스페이스 선택' })).toBeInTheDocument()
  })
})
