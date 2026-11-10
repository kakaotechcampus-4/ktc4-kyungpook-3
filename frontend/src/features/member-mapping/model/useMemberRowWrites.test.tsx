import { QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { onTestFinished } from 'vitest'
import { memberListQueryOptions } from '@/entities/member'
import { createQueryClient } from '@/shared/api/queryClient'
import { endSessionScope } from '@/shared/api/sessionScope'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import { useMemberRowWrites } from './useMemberRowWrites'

function renderWrites(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(
    () => ({
      writes: useMemberRowWrites('ws_01'),
      members: useQuery(memberListQueryOptions('ws_01')).data,
    }),
    { wrapper },
  )
}

const memberWrites = (log: ReturnType<typeof recordRequests>) =>
  log.started
    .filter(({ method, path }) => method !== 'GET' && path.startsWith('/members'))
    .map(({ method, path }) => `${method} ${path}`)

const markListStale = (client: QueryClient) =>
  act(() =>
    client.invalidateQueries({
      queryKey: memberListQueryOptions('ws_01').queryKey,
      refetchType: 'none',
    }),
  )

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('useMemberRowWrites', () => {
  it('누른 뒤 보내기 전에 세션이 끝나면 다시 연결돼도 보내지 않는다', async () => {
    const client = createQueryClient()
    const { result } = renderWrites(client)
    await waitFor(() => expect(result.current.members).toBeDefined())
    const log = recordRequests()
    const onSuccess = vi.fn()

    onlineManager.setOnline(false)
    act(() => {
      result.current.writes.run(
        { kind: 'create', displayName: '최지훈', discordUserId: null },
        onSuccess,
      )
    })
    await waitFor(() =>
      expect(
        client
          .getMutationCache()
          .getAll()
          .filter(({ state }) => state.isPaused),
      ).toHaveLength(1),
    )
    act(() => endSessionScope())
    onlineManager.setOnline(true)

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(memberWrites(log)).toEqual([])
    expect(onSuccess).not.toHaveBeenCalled()
    expect(result.current.writes.failure).toBeNull()
    expect(db.members.some(({ display_name }) => display_name === '최지훈')).toBe(false)
  })

  it('보낸 뒤 세션이 바뀌면 늦은 응답은 캐시·문구에 남기지 않는다', async () => {
    const gate = deferred()
    onTestFinished(() => gate.resolve())
    server.use(
      http.patch('/api/v1/members/mb_02', async () => {
        await gate.promise
        return fail('INTERNAL_ERROR', 'late', 500)
      }),
    )
    const client = createQueryClient()
    const { result } = renderWrites(client)
    await waitFor(() => expect(result.current.members).toBeDefined())
    const onSuccess = vi.fn()

    act(() => {
      result.current.writes.run(
        { kind: 'rename', memberId: 'mb_02', displayName: '박민준' },
        onSuccess,
      )
    })
    await waitFor(() => expect(result.current.writes.pending?.kind).toBe('rename'))
    act(() => endSessionScope())
    gate.resolve()

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(result.current.writes.failure).toBeNull()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(result.current.members?.find(({ id }) => id === 'mb_02')?.displayName).toBe('박민수')
  })

  it('목록을 믿을 수 없으면 다시 받아 같은 이름을 확인하고, 있으면 보내지 않는다', async () => {
    const client = createQueryClient()
    const { result } = renderWrites(client)
    await waitFor(() => expect(result.current.members).toBeDefined())
    db.members.push({
      member_id: 'mb_77',
      workspace_id: 'ws_01',
      display_name: '최지훈',
      discord_user_id: null,
      notion_name: null,
      role: 'member',
      has_login_account: false,
      created_at: MOCK_NOW,
    })
    await markListStale(client)
    const log = recordRequests()
    const onSuccess = vi.fn()

    act(() => {
      result.current.writes.run(
        { kind: 'create', displayName: '최지훈', discordUserId: null },
        onSuccess,
      )
    })

    await waitFor(() =>
      expect(result.current.writes.failure?.message).toBe('이미 같은 이름의 팀원이 있어요.'),
    )
    expect(memberWrites(log)).toEqual([])
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('옮기기 전에 다시 받은 목록에서 계정 주인이 바뀌었으면 그 팀원의 연결은 풀지 않는다', async () => {
    const client = createQueryClient()
    const { result } = renderWrites(client)
    await waitFor(() => expect(result.current.members).toBeDefined())
    // 화면은 1124 를 박민수(mb_02)에 연결된 것으로 본다. 서버에서는 그사이 연결이 풀렸다
    db.members.find(({ member_id }) => member_id === 'mb_02')!.discord_user_id = null
    await markListStale(client)
    const log = recordRequests()
    const bodies = recordRequestBodies('PATCH', '/members/mb_03')

    act(() => {
      result.current.writes.run({
        kind: 'move',
        fromId: 'mb_02',
        memberId: 'mb_03',
        discordUserId: '1124',
      })
    })

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(memberWrites(log)).toEqual(['PATCH /members/mb_03'])
    await waitFor(() => expect(bodies).toEqual([{ discord_user_id: '1124' }]))
  })

  it('같은 틱에 두 번 부르면 두 번째는 막는다', async () => {
    const client = createQueryClient()
    const { result } = renderWrites(client)
    await waitFor(() => expect(result.current.members).toBeDefined())
    const log = recordRequests()

    const results: string[] = []
    act(() => {
      results.push(result.current.writes.run({ kind: 'unlink', memberId: 'mb_02' }))
      results.push(
        result.current.writes.run({ kind: 'link', memberId: 'mb_03', discordUserId: '1125' }),
      )
    })

    expect(results).toEqual(['started', 'blocked'])
    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(memberWrites(log)).toEqual(['PATCH /members/mb_02'])
  })
})
