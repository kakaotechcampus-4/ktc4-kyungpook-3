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
import { recordRequests } from '@/shared/test/requests'
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

const dbMember = (id: string) => {
  const member = db.members.find(({ member_id }) => member_id === id)
  if (member === undefined) throw new Error(`${id} missing`)
  return member
}

const MOVE_STALE = '그사이 연결이 바뀌었어요. 새 목록에서 다시 골라 주세요.'

const moveToJaehwan = {
  kind: 'move',
  fromId: 'mb_02',
  memberId: 'mb_03',
  discordUserId: '1124',
} as const

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

  it('옮기기 전에 목록이 무효가 아니어도 다시 받는다. 계정 주인이 다른 팀원으로 바뀌었으면 아무것도 보내지 않고 다시 고르게 한다', async () => {
    const client = createQueryClient()
    const { result } = renderWrites(client)
    await waitFor(() => expect(result.current.members).toBeDefined())
    // 화면은 1124 를 박민수(mb_02)에 연결된 것으로 본다. 다른 탭에서 박민수는 1125 로, 1124 는 정하늘(mb_04)로 바뀌었다
    dbMember('mb_02').discord_user_id = '1125'
    dbMember('mb_04').discord_user_id = '1124'
    const log = recordRequests()

    act(() => {
      result.current.writes.run(moveToJaehwan)
    })

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(memberWrites(log)).toEqual([])
    expect(dbMember('mb_02').discord_user_id).toBe('1125')
    expect(dbMember('mb_04').discord_user_id).toBe('1124')
    expect(dbMember('mb_03').discord_user_id).toBeNull()
    expect(result.current.writes.failure).toEqual({
      target: 'member:mb_03',
      write: moveToJaehwan,
      message: MOVE_STALE,
      retry: null,
    })
    // 새 목록이 캐시에 있어 다시 고를 때는 지금 주인을 본다
    await waitFor(() =>
      expect(result.current.members?.find(({ id }) => id === 'mb_04')?.discordUserId).toBe('1124'),
    )
  })

  it('옮기기 전에 다시 받은 목록에서 계정이 아무에게도 연결돼 있지 않으면 보내지 않고 다시 고르게 한다', async () => {
    const client = createQueryClient()
    const { result } = renderWrites(client)
    await waitFor(() => expect(result.current.members).toBeDefined())
    dbMember('mb_02').discord_user_id = null
    await markListStale(client)
    const log = recordRequests()

    act(() => {
      result.current.writes.run(moveToJaehwan)
    })

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(memberWrites(log)).toEqual([])
    expect(result.current.writes.failure?.message).toBe(MOVE_STALE)
  })

  it('옮기기 전에 다시 받은 목록에서 이미 옮길 팀원에 연결돼 있으면 보내지 않고 끝난다', async () => {
    const client = createQueryClient()
    const { result } = renderWrites(client)
    await waitFor(() => expect(result.current.members).toBeDefined())
    dbMember('mb_02').discord_user_id = null
    dbMember('mb_03').discord_user_id = '1124'
    const log = recordRequests()

    act(() => {
      result.current.writes.run(moveToJaehwan)
    })

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(memberWrites(log)).toEqual([])
    expect(result.current.writes.failure).toBeNull()
  })

  it('옮기기 전에 다시 받은 목록에서도 앞 팀원이 주인이면 풀고 잇는다', async () => {
    const client = createQueryClient()
    const { result } = renderWrites(client)
    await waitFor(() => expect(result.current.members).toBeDefined())
    const log = recordRequests()

    act(() => {
      result.current.writes.run(moveToJaehwan)
    })

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(memberWrites(log)).toEqual(['PATCH /members/mb_02', 'PATCH /members/mb_03'])
    expect(dbMember('mb_03').discord_user_id).toBe('1124')
    expect(result.current.writes.failure).toBeNull()
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
