import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { advanceSessionGeneration } from '@/entities/user'
import { createQueryClient } from '@/shared/api/queryClient'
import { db } from '@/shared/mock/db'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import type { RequestLog } from '@/shared/test/requests'
import { useMessageSettings } from './useMessageSettings'

const SETTINGS_PATH = '/api/v1/workspaces/ws_01/message-settings'

function renderSettings(client: QueryClient = createQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useMessageSettings('ws_01'), { wrapper })
}

const patchCount = (log: RequestLog) =>
  log.started.filter(({ method, path }) => method === 'PATCH' && path.endsWith('/message-settings'))
    .length

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
})
