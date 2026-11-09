import { QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { latestInvitationsQueryOptions } from '@/entities/invitation'
import { advanceSessionGeneration } from '@/entities/user'
import { createQueryClient } from '@/shared/api/queryClient'
import { recordRequests } from '@/shared/test/requests'
import { useMemberInviteActions } from './useMemberInviteActions'

afterEach(() => {
  onlineManager.setOnline(true)
})

const invitee = { userId: 'us_05', username: 'doyun', name: '한도윤' }

function setup() {
  const client = createQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useMemberInviteActions('ws_01', 'mb_02'), { wrapper })
  return { client, actions: () => result.current }
}

// #594 — 오프라인으로 멈춘 사이 계정이 바뀌면 다음 계정의 쿠키로 초대·취소·연결 끊기가 나가지 않는다
it.each([
  [
    '초대 만들기',
    'POST /workspaces/ws_01/invitations',
    (a: ReturnType<typeof useMemberInviteActions>) => a.invite(invitee, () => {}),
  ],
  [
    '초대 취소',
    'POST /invitations/iv_01/cancel',
    (a: ReturnType<typeof useMemberInviteActions>) => a.cancel('iv_01'),
  ],
  [
    '계정 연결 끊기',
    'POST /invitations/iv_01/revoke',
    (a: ReturnType<typeof useMemberInviteActions>) => a.revoke('iv_01', () => {}),
  ],
])(
  '오프라인으로 멈춘 사이 세션이 바뀌면 다시 연결돼도 %s 를 보내지 않는다',
  async (_, request, start) => {
    const { client, actions } = setup()
    const log = recordRequests()
    onlineManager.setOnline(false)
    act(() => start(actions()))
    await waitFor(() =>
      expect(client.getMutationCache().getAll().at(-1)?.state.isPaused).toBe(true),
    )

    act(() => advanceSessionGeneration())
    onlineManager.setOnline(true)

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(log.timeline).not.toContain(`start ${request}`)
  },
)

it('같은 세션이면 다시 연결될 때 초대를 보낸다', async () => {
  const { client, actions } = setup()
  const log = recordRequests()
  onlineManager.setOnline(false)
  act(() => actions().invite(invitee, () => {}))
  await waitFor(() => expect(client.getMutationCache().getAll().at(-1)?.state.isPaused).toBe(true))

  onlineManager.setOnline(true)

  await waitFor(() => expect(log.timeline).toContain('start POST /workspaces/ws_01/invitations'))
})

// #594 리뷰 — 보내지 않은 쓰기는 실패 문구를 남기지 않고, 다음 세션의 초대 목록을 다시 받지 않는다
it.each([
  ['초대 만들기', (a: ReturnType<typeof useMemberInviteActions>) => a.invite(invitee, () => {})],
  ['초대 취소', (a: ReturnType<typeof useMemberInviteActions>) => a.cancel('iv_01')],
])('세션이 바뀌어 보내지 않으면 %s 의 실패 문구도 목록 다시 받기도 없다', async (_, start) => {
  const client = createQueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(
    () => {
      const invitations = useQuery(latestInvitationsQueryOptions('ws_01'))
      const actions = useMemberInviteActions('ws_01', 'mb_02')
      return { invitations, actions }
    },
    { wrapper },
  )
  await waitFor(() => expect(result.current.invitations.isSuccess).toBe(true))
  const log = recordRequests()
  onlineManager.setOnline(false)
  act(() => start(result.current.actions))
  await waitFor(() => expect(client.getMutationCache().getAll().at(-1)?.state.isPaused).toBe(true))

  act(() => advanceSessionGeneration())
  onlineManager.setOnline(true)

  await waitFor(() => expect(client.isMutating()).toBe(0))
  expect(result.current.actions.inviteError).toBeNull()
  expect(log.timeline).not.toContain('start GET /workspaces/ws_01/invitations')
})
