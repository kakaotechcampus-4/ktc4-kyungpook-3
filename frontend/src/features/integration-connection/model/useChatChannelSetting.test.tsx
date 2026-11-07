import { QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { getResponse, http } from 'msw'
import type { ReactNode } from 'react'
import { integrationsQueryOptions } from '@/entities/integration'
import { advanceSessionGeneration } from '@/entities/user'
import { createQueryClient } from '@/shared/api/queryClient'
import { handlers } from '@/shared/mock/handlers'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { useToastStore } from '@/shared/ui/toast'
import { useChatChannelSetting } from './useChatChannelSetting'

const CHAT_CHANNEL_PATH = '/api/v1/workspaces/ws_01/integrations/discord/chat-channel'
const GENERAL = '1300000000000000001'

/** 설정 화면처럼 연동 조회를 지켜보며 고른다 */
function renderSetting(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(
    () => ({
      integrations: useQuery(integrationsQueryOptions('ws_01')),
      setting: useChatChannelSetting('ws_01', true),
    }),
    { wrapper },
  )
}

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('useChatChannelSetting — 세션이 끝난 저장', () => {
  it('오프라인으로 기다리는 사이 세션이 끝나면 다시 연결돼도 저장을 보내지 않는다', async () => {
    const client = createQueryClient()
    const { result } = renderSetting(client)
    await waitFor(() => expect(result.current.integrations.data).toBeDefined())
    const log = recordRequests()
    const onSaved = vi.fn()

    onlineManager.setOnline(false)
    act(() => result.current.setting.save(GENERAL, onSaved))
    await waitFor(() =>
      expect(client.getMutationCache().getAll().at(-1)?.state.isPaused).toBe(true),
    )
    act(() => advanceSessionGeneration())
    onlineManager.setOnline(true)

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(log.started.filter(({ method }) => method === 'PUT')).toEqual([])
    expect(onSaved).not.toHaveBeenCalled()
    expect(result.current.setting.failure).toBeNull()
    expect(result.current.integrations.data?.discord.chatChannel).toBeNull()
  })

  it('보낸 뒤 응답 전에 세션이 끝나면 늦은 응답을 캐시·알림·실패 문구에 남기지 않는다', async () => {
    const gate = deferred()
    server.use(
      http.put(
        CHAT_CHANNEL_PATH,
        async ({ request }) => {
          await gate.promise
          return getResponse(handlers, request)
        },
        { once: true },
      ),
    )
    const client = createQueryClient()
    const { result } = renderSetting(client)
    await waitFor(() => expect(result.current.integrations.data).toBeDefined())
    const log = recordRequests()
    const onSaved = vi.fn()

    act(() => result.current.setting.save(GENERAL, onSaved))
    await waitFor(() =>
      expect(log.started.filter(({ method }) => method === 'PUT')).toHaveLength(1),
    )
    act(() => advanceSessionGeneration())
    gate.resolve()

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(onSaved).not.toHaveBeenCalled()
    expect(result.current.setting.failure).toBeNull()
    expect(
      client.getQueryData(integrationsQueryOptions('ws_01').queryKey)?.discord.chatChannel,
    ).toBeNull()
    expect(useToastStore.getState().items).toEqual([])
  })
})
