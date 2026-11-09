import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { approvalDetailQueryOptions } from '@/entities/approval'
import { advanceSessionGeneration } from '@/entities/user'
import { useApprovalResolve } from '@/features/approval-resolve'
import { useAutoItemRevert } from '@/features/auto-item-revert'
import { useTaskCreate } from '@/features/task-create'
import { useTaskNotionSync } from '@/features/task-notion-sync'
import { useTaskStatusChange } from '@/features/task-status'
import { createQueryClient } from '@/shared/api/queryClient'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { recordRequests } from '@/shared/test/requests'

/*
 * #594 — 누를 때의 세션에서만 쓰기를 보낸다. 오프라인으로 멈춘 쓰기는 다시 연결되면 이어서 나가는데(TanStack 의 기본
 * `networkMode: 'online'`), 그 사이 계정이 바뀌었으면 다음 계정의 쿠키로 나가면 안 된다
 */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  onlineManager.setOnline(true)
  vi.useRealTimers()
})

interface WriteCase {
  name: string
  request: string
  start: (client: QueryClient) => (() => void) | Promise<() => void>
}

function hook<T>(client: QueryClient, use: () => T): () => T {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/workspaces/ws_01/tasks']}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
  const { result } = renderHook(use, { wrapper })
  return () => result.current
}

const CASES: WriteCase[] = [
  {
    name: '승인 반려',
    request: 'PATCH /approvals/ap_01',
    start: async (client) => {
      const approval = await client.fetchQuery(approvalDetailQueryOptions('ws_01', 'ap_01'))
      const current = hook(client, () => useApprovalResolve('ws_01', 'ap_01', []))
      return () => current().reject(approval)
    },
  },
  {
    name: '태스크 상태 바꾸기',
    request: 'PATCH /tasks/tk_01',
    start: (client) => {
      const current = hook(client, () => useTaskStatusChange('ws_01', 'tk_01'))
      return () => current().change('done')
    },
  },
  {
    name: '태스크 만들기',
    request: 'POST /tasks',
    start: (client) => {
      const current = hook(client, () => useTaskCreate('ws_01', 'todo'))
      return () =>
        current().create({ title: '새 태스크', status: 'todo', assigneeMemberId: null }, () => {})
    },
  },
  {
    name: 'Notion 반영 다시 넣기',
    request: 'POST /tasks/tk_01/notion-sync/retry',
    start: (client) => {
      const current = hook(client, () => useTaskNotionSync('ws_01', 'tk_01'))
      return () => current().retry()
    },
  },
  {
    name: '자동 반영 되돌리기',
    request: 'POST /extractions/ex_01/items/it_01/revert',
    start: (client) => {
      const current = hook(client, () => useAutoItemRevert('ws_01'))
      return () => current().revert('ex_01', 'it_01')
    },
  },
]

async function pauseOffline(client: QueryClient, start: () => void) {
  onlineManager.setOnline(false)
  act(start)
  await waitFor(() => expect(client.getMutationCache().getAll().at(-1)?.state.isPaused).toBe(true))
}

describe.each(CASES)('$name', ({ request, start }) => {
  it('오프라인으로 멈춘 사이 세션이 바뀌면 다시 연결돼도 보내지 않는다', async () => {
    const client = createQueryClient()
    const trigger = await start(client)
    const log = recordRequests()
    await pauseOffline(client, trigger)

    // 실제 로그아웃·다른 계정 로그인처럼 세대를 먼저 올린다
    act(() => advanceSessionGeneration())
    onlineManager.setOnline(true)

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(log.timeline).not.toContain(`start ${request}`)
  })

  it('같은 세션이면 다시 연결될 때 보낸다', async () => {
    const client = createQueryClient()
    const trigger = await start(client)
    const log = recordRequests()
    await pauseOffline(client, trigger)

    onlineManager.setOnline(true)

    await waitFor(() => expect(log.timeline).toContain(`start ${request}`))
  })
})
