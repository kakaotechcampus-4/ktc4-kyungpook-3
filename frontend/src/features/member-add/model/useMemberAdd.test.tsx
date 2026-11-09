import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { memberListQueryOptions } from '@/entities/member'
import { createQueryClient } from '@/shared/api/queryClient'
import { endSessionScope } from '@/shared/api/sessionScope'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { recordRequests } from '@/shared/test/requests'
import { useMemberAdd } from './useMemberAdd'

function renderAdd(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useMemberAdd('ws_01'), { wrapper })
}

const memberPosts = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ method, path }) => method === 'POST' && path === '/members')

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('useMemberAdd', () => {
  it('누른 뒤 보내기 전에 세션이 끝나면 다시 연결돼도 보내지 않는다', async () => {
    const client = createQueryClient()
    const { result } = renderAdd(client)
    await waitFor(() => expect(result.current.ready).toBe(true))
    const log = recordRequests()
    const onAdded = vi.fn()

    onlineManager.setOnline(false)
    act(() => result.current.add('최지훈', onAdded))
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
    expect(memberPosts(log)).toEqual([])
    expect(onAdded).not.toHaveBeenCalled()
    expect(result.current.feedback).toBeNull()
    expect(db.members.some(({ display_name }) => display_name === '최지훈')).toBe(false)
  })

  it('목록을 믿을 수 없으면 다시 받아 같은 이름을 확인하고, 있으면 보내지 않는다', async () => {
    const client = createQueryClient()
    const { result } = renderAdd(client)
    await waitFor(() => expect(result.current.ready).toBe(true))
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
    await act(() =>
      client.invalidateQueries({
        queryKey: memberListQueryOptions('ws_01').queryKey,
        refetchType: 'none',
      }),
    )
    const log = recordRequests()
    const onAdded = vi.fn()

    act(() => result.current.add('최지훈', onAdded))

    await waitFor(() => expect(result.current.feedback).toBe('이미 같은 이름의 팀원이 있어요.'))
    expect(memberPosts(log)).toEqual([])
    expect(onAdded).not.toHaveBeenCalled()
  })
})
