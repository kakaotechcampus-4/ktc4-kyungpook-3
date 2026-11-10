import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { getResponse, http } from 'msw'
import type { ReactNode } from 'react'
import { messageSettingsQueryOptions } from '@/entities/message-settings'
import { advanceSessionGeneration, clearUserCache } from '@/entities/user'
import { createQueryClient } from '@/shared/api/queryClient'
import { db } from '@/shared/mock/db'
import { handlers } from '@/shared/mock/handlers'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import type { RequestLog } from '@/shared/test/requests'
import { useMessageSettings } from './useMessageSettings'

const SETTINGS_PATH = '/api/v1/workspaces/ws_01/message-settings'
const { queryKey } = messageSettingsQueryOptions('ws_01')

function renderSettings(client: QueryClient = createQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useMessageSettings('ws_01'), { wrapper })
}

const settingsRequests = (log: RequestLog, kind: 'start' | 'answer', method: 'GET' | 'PATCH') =>
  log.timeline.filter((line) => line === `${kind} ${method} /workspaces/ws_01/message-settings`)
    .length

const patchCount = (log: RequestLog) => settingsRequests(log, 'start', 'PATCH')

/** 다음 설정 GET 하나를 붙잡는다. 답은 요청을 받은 그 순간의 서버 값이다 — 풀기 전에 서버가 바뀌어도 이전 값을 돌려준다 */
function holdSettingsSnapshot() {
  const gate = deferred()
  server.use(
    http.get(
      SETTINGS_PATH,
      async ({ request }) => {
        const snapshot = await getResponse(handlers, request.clone())
        await gate.promise
        return snapshot
      },
      { once: true },
    ),
  )
  return gate
}

describe('useMessageSettings', () => {
  beforeEach(() => {
    applyScenario('settings-unmapped')
  })

  it('앞 변경을 기다리는 사이 세션이 끝나면 대기 중인 변경을 보내지 않는다', async () => {
    const client = createQueryClient()
    const { result } = renderSettings(client)
    await waitFor(() => expect(result.current.settings).toBeDefined())
    const log = recordRequests()
    const first = deferred()
    server.use(
      http.patch(
        SETTINGS_PATH,
        async () => {
          await first.promise
        },
        { once: true },
      ),
    )

    act(() => {
      result.current.change({ silenceAlert: false })
      result.current.change({ reminderAutoApprove: true })
    })
    await waitFor(() => expect(patchCount(log)).toBe(1))
    // 실제 로그아웃처럼 세대를 먼저 올린다. 다음 계정이 로그인해도 이전 세션의 대기 변경이 그 쿠키로 나가지 않아야 한다
    act(() => advanceSessionGeneration())
    first.resolve()

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(patchCount(log)).toBe(1)
    expect(db.messageSettings.ws_01?.reminder_auto_approve).not.toBe(true)
  })

  it('저장 중에 한 번 더 바꾸고 로그아웃하면 기다리던 변경도 보내지 않고 끝난다 (#681)', async () => {
    const client = createQueryClient()
    const { result } = renderSettings(client)
    await waitFor(() => expect(result.current.settings).toBeDefined())
    const log = recordRequests()
    const first = deferred()
    onTestFinished(() => first.resolve())
    server.use(
      http.patch(
        SETTINGS_PATH,
        async () => {
          await first.promise
        },
        { once: true },
      ),
    )
    act(() => {
      result.current.change({ silenceAlert: false })
      result.current.change({ reminderAutoApprove: true })
    })
    await waitFor(() => expect(patchCount(log)).toBe(1))
    const waiting = client
      .getMutationCache()
      .getAll()
      .find(({ state }) => state.isPaused)
    expect(waiting?.state.variables).toMatchObject({ change: { reminderAutoApprove: true } })

    act(() => {
      advanceSessionGeneration()
      clearUserCache(client)
    })

    await waitFor(() => expect(waiting?.state.status).toBe('error'))
    expect(waiting?.state.error).toMatchObject({ code: 'REQUEST_CANCELED' })
    expect(client.getMutationCache().getAll()).toEqual([])
    expect(patchCount(log)).toBe(1)
  })

  it('변경 전 값을 읽은 조회가 변경 성공 뒤에 끝나도 저장한 값을 덮지 않고, 끝나면 서버 값을 다시 읽는다', async () => {
    const client = createQueryClient()
    const { result } = renderSettings(client)
    await waitFor(() => expect(result.current.settings?.dueReminder).toBe(true))
    const log = recordRequests()
    const staleRead = holdSettingsSnapshot()
    act(() => void client.refetchQueries({ queryKey }))
    await waitFor(() => expect(settingsRequests(log, 'start', 'GET')).toBe(1))

    act(() => result.current.change({ dueReminder: false }))
    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(db.messageSettings.ws_01?.due_reminder).toBe(false)
    staleRead.resolve()

    await waitFor(() => expect(client.getQueryState(queryKey)?.fetchStatus).toBe('idle'))
    expect(result.current.settings?.dueReminder).toBe(false)
    expect(client.getQueryData(queryKey)?.dueReminder).toBe(false)
    expect(settingsRequests(log, 'start', 'GET')).toBe(2)
  })

  it('이어서 바꾼 변경이 모두 끝난 뒤에 한 번만 서버 값을 다시 읽는다', async () => {
    const client = createQueryClient()
    const { result } = renderSettings(client)
    await waitFor(() => expect(result.current.settings).toBeDefined())
    const log = recordRequests()

    act(() => {
      result.current.change({ silenceAlert: false })
      result.current.change({ pmAlertMethod: 'web' })
    })
    await waitFor(() => expect(client.isMutating()).toBe(0))
    await waitFor(() => expect(settingsRequests(log, 'answer', 'GET')).toBe(1))

    const settings = '/workspaces/ws_01/message-settings'
    expect(log.timeline).toEqual([
      `start PATCH ${settings}`,
      `answer PATCH ${settings}`,
      `start PATCH ${settings}`,
      `answer PATCH ${settings}`,
      `start GET ${settings}`,
      `answer GET ${settings}`,
    ])
    expect(result.current.settings).toMatchObject({ silenceAlert: false, pmAlertMethod: 'web' })
  })
})
