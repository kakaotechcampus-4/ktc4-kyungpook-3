import { QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { getResponse, http } from 'msw'
import type { ReactNode } from 'react'
import { messageInboxQueryOptions } from '@/entities/message'
import type { CreatedReminder, ReminderCreateInput } from '@/entities/message'
import { advanceSessionGeneration } from '@/entities/user'
import { createQueryClient } from '@/shared/api/queryClient'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { handlers } from '@/shared/mock/handlers'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import type { RequestLog } from '@/shared/test/requests'
import { useCreateReminder } from './useCreateReminder'

const INBOX_PATH = '/api/v1/workspaces/ws_01/messages'
const inboxKey = messageInboxQueryOptions('ws_01').queryKey

/** 이재환(mb_03)의 DB 스키마 정리(tk_03)를 마감 하루 전에. 같은 시각의 묶음이 없어 새 묶음이 생긴다 */
const INPUT: ReminderCreateInput = {
  memberId: 'mb_03',
  taskId: 'tk_03',
  scheduledAt: '2026-09-21T09:00:00+09:00',
  note: null,
}

/** 메시지 화면처럼 목록 조회를 지켜보며 만든다 */
function renderCreate(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(
    () => ({
      inbox: useQuery(messageInboxQueryOptions('ws_01')),
      creating: useCreateReminder('ws_01'),
    }),
    { wrapper },
  )
}

const count = (log: RequestLog, line: string) =>
  log.timeline.filter((entry) => entry === line).length

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
  applyScenario('messages-default')
})
afterEach(() => {
  onlineManager.setOnline(true)
  vi.useRealTimers()
})

describe('useCreateReminder', () => {
  it('오프라인으로 기다리는 사이 세션이 끝나면 다시 연결돼도 만들기를 보내지 않는다', async () => {
    const client = createQueryClient()
    const { result } = renderCreate(client)
    await waitFor(() => expect(result.current.inbox.data).toBeDefined())
    const log = recordRequests()
    const onCreated = vi.fn()

    onlineManager.setOnline(false)
    act(() => result.current.creating.create(INPUT, onCreated))
    await waitFor(() =>
      expect(client.getMutationCache().getAll().at(-1)?.state.isPaused).toBe(true),
    )
    // 실제 로그아웃처럼 세대를 먼저 올린다. 다음 계정의 쿠키로 이전 세션의 만들기가 나가지 않아야 한다
    act(() => advanceSessionGeneration())
    onlineManager.setOnline(true)

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(count(log, 'start POST /workspaces/ws_01/messages/reminders')).toBe(0)
    expect(onCreated).not.toHaveBeenCalled()
    expect(result.current.creating.failure).toBeNull()
  })

  it('만들기 전에 출발한 첫 목록 조회가 늦게 끝나도 새로 받은 목록에 만든 묶음이 있을 때 넘긴다', async () => {
    const gate = deferred()
    server.use(
      http.get(
        INBOX_PATH,
        async ({ request }) => {
          // 요청을 받은 그 순간의 목록이다 — 풀기 전에 만들어도 만든 묶음이 없다
          const snapshot = await getResponse(handlers, request.clone())
          await gate.promise
          return snapshot
        },
        { once: true },
      ),
    )
    const log = recordRequests()
    const client = createQueryClient()
    const { result } = renderCreate(client)
    await waitFor(() => expect(count(log, 'start GET /workspaces/ws_01/messages')).toBe(1))
    expect(result.current.inbox.data).toBeUndefined()

    let listedOnCreate: boolean | undefined
    const onCreated = vi.fn(({ bundle }: CreatedReminder) => {
      const inbox = client.getQueryData(inboxKey)
      listedOnCreate = inbox?.viewer === 'pm' && inbox.bundles.some(({ id }) => id === bundle.id)
    })
    act(() => result.current.creating.create(INPUT, onCreated))
    await waitFor(() =>
      expect(count(log, 'answer POST /workspaces/ws_01/messages/reminders')).toBe(1),
    )
    gate.resolve()

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))
    expect(listedOnCreate).toBe(true)
    expect(count(log, 'start GET /workspaces/ws_01/messages')).toBe(2)
  })
})
