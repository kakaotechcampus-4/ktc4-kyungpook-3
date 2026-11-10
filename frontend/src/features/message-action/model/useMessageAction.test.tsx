import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { advanceSessionGeneration } from '@/entities/user'
import { createQueryClient } from '@/shared/api/queryClient'
import { db } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { applyScenario } from '@/shared/mock/scenarios'
import { recordRequests } from '@/shared/test/requests'
import { http } from 'msw'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { toast } from '@/shared/ui/toast'
import { useMessageAction } from './useMessageAction'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
  applyScenario('messages-default')
})
afterEach(() => {
  onlineManager.setOnline(true)
  vi.useRealTimers()
})

describe('useMessageAction', () => {
  it('오프라인으로 기다리는 사이 세션이 끝나면 다시 연결돼도 태스크 빼기를 보내지 않는다', async () => {
    const client = createQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useMessageAction('ws_01'), { wrapper })
    const log = recordRequests()
    const onSuccess = vi.fn()

    onlineManager.setOnline(false)
    act(() =>
      result.current.run(
        { kind: 'removeTask', bundleId: 'bd_02', reminderId: 'rm_02' },
        { onSuccess },
      ),
    )
    await waitFor(() =>
      expect(client.getMutationCache().getAll().at(-1)?.state.isPaused).toBe(true),
    )
    // 실제 로그아웃처럼 세대를 먼저 올린다. 다음 계정의 쿠키로 이전 세션의 쓰기가 나가지 않아야 한다
    act(() => advanceSessionGeneration())
    onlineManager.setOnline(true)

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(log.timeline).not.toContain(
      'start POST /workspaces/ws_01/messages/reminders/rm_02/cancel',
    )
    expect(
      db.messageBundles
        .find(({ bundle_id }) => bundle_id === 'bd_02')
        ?.reminders.find(({ reminder_id }) => reminder_id === 'rm_02')?.status,
    ).toBe('scheduled')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(result.current.failure).toBeNull()
  })

  it('태스크 빼기 응답을 읽지 못하면 실패로 남기지 않고 결과를 확인하지 못했다고 알린다. 새로고침은 메시지를 다시 받는다 (#348)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const shown = vi.spyOn(toast, 'show')
    server.use(
      http.post('/api/v1/workspaces/:workspaceId/messages/reminders/:reminderId/cancel', () =>
        ok({ reminder: { reminder_id: 'rm_02' }, bundle: { bundle_id: 'bd_02' } }),
      ),
    )
    const client = createQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useMessageAction('ws_01'), { wrapper })
    const onSuccess = vi.fn()
    act(() =>
      result.current.run(
        { kind: 'removeTask', bundleId: 'bd_02', reminderId: 'rm_02' },
        { onSuccess },
      ),
    )
    await waitFor(() => expect(client.isMutating()).toBe(0))

    expect(result.current.failure).toBeNull()
    expect(onSuccess).not.toHaveBeenCalled()
    const notice = shown.mock.calls.at(-1)?.[0]
    expect(notice).toMatchObject({
      key: 'write-unconfirmed',
      title: '변경 결과를 확인하지 못했어요',
    })
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    act(() => notice?.action?.onClick())
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workspace', 'ws_01', 'messages'] })
    vi.restoreAllMocks()
  })
})
