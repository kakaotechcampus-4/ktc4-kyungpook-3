import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { advanceSessionGeneration } from '@/entities/user'
import { createQueryClient } from '@/shared/api/queryClient'
import { db } from '@/shared/mock/db'
import { applyScenario } from '@/shared/mock/scenarios'
import { recordRequests } from '@/shared/test/requests'
import { toast } from '@/shared/ui/toast'
import { useReplyChangeUndo } from './useReplyChangeUndo'

const UNDO = 'start POST /tasks/tk_03/reply-changes/rc_02/undo'

function renderUndo(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(() => useReplyChangeUndo('ws_01', 'tk_03'), { wrapper })
}

const tk03Status = () => db.tasks.find(({ task_id }) => task_id === 'tk_03')?.status

beforeEach(() => applyScenario('reply-judgment'))
afterEach(() => onlineManager.setOnline(true))

describe('useReplyChangeUndo', () => {
  it('누른 뒤 보내기 전에 세션이 바뀌면 되돌리기를 보내지 않고 알리지도 않는다', async () => {
    const client = createQueryClient()
    const { result } = renderUndo(client)
    const log = recordRequests()
    const shown = vi.spyOn(toast, 'show')

    onlineManager.setOnline(false)
    act(() => result.current.undo('rc_02'))
    await waitFor(() =>
      expect(client.getMutationCache().getAll().at(-1)?.state.isPaused).toBe(true),
    )
    act(() => advanceSessionGeneration())
    onlineManager.setOnline(true)

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(log.timeline).not.toContain(UNDO)
    expect(tk03Status()).toBe('done')
    expect(shown).not.toHaveBeenCalled()
  })

  it('같은 세션이면 그 줄만 되돌리는 중이고, 끝나면 서버 값이 바뀌어 있다', async () => {
    const client = createQueryClient()
    const { result } = renderUndo(client)
    const log = recordRequests()

    onlineManager.setOnline(false)
    act(() => result.current.undo('rc_02'))
    await waitFor(() => expect(result.current.pendingChangeId).toBe('rc_02'))
    onlineManager.setOnline(true)

    await waitFor(() => expect(result.current.pendingChangeId).toBeNull())
    expect(log.timeline).toContain(UNDO)
    expect(tk03Status()).toBe('blocked')
  })
})
