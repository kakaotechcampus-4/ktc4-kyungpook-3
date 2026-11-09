import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { advanceSessionGeneration } from '@/entities/user'
import { createQueryClient } from '@/shared/api/queryClient'
import { captureSessionScope } from '@/shared/api/sessionScope'
import { recordRequests } from '@/shared/test/requests'
import { useDisconnectIntegration } from './useDisconnectIntegration'

afterEach(() => {
  onlineManager.setOnline(true)
})

function setup() {
  const client = createQueryClient()
  const onDisconnected = vi.fn()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useDisconnectIntegration('ws_01', 'notion', onDisconnected), {
    wrapper,
  })
  return { client, onDisconnected, disconnect: () => result.current }
}

async function pauseOffline(client: ReturnType<typeof createQueryClient>, start: () => void) {
  onlineManager.setOnline(false)
  act(start)
  await waitFor(() => expect(client.getMutationCache().getAll().at(-1)?.state.isPaused).toBe(true))
}

describe('useDisconnectIntegration (#594)', () => {
  it('오프라인으로 멈춘 사이 세션이 바뀌면 다시 연결돼도 끊지 않고 뒷처리도 하지 않는다', async () => {
    const { client, onDisconnected, disconnect } = setup()
    const log = recordRequests()
    await pauseOffline(client, () => disconnect().mutate(captureSessionScope()))

    act(() => advanceSessionGeneration())
    onlineManager.setOnline(true)

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(log.timeline).not.toContain('start DELETE /workspaces/ws_01/integrations/notion')
    expect(onDisconnected).not.toHaveBeenCalled()
  })

  it('같은 세션이면 다시 연결될 때 끊는다', async () => {
    const { client, onDisconnected, disconnect } = setup()
    const log = recordRequests()
    await pauseOffline(client, () => disconnect().mutate(captureSessionScope()))

    onlineManager.setOnline(true)

    await waitFor(() => expect(onDisconnected).toHaveBeenCalled())
    expect(log.timeline).toContain('start DELETE /workspaces/ws_01/integrations/notion')
  })
})
