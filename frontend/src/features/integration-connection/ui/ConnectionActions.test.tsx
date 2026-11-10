import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { advanceSessionGeneration } from '@/entities/user'
import { createQueryClient } from '@/shared/api/queryClient'
import { ConnectionActions } from './ConnectionActions'

afterEach(() => {
  onlineManager.setOnline(true)
})

// #594 리뷰 — 끝난 세션이라 보내지 않은 끊기는 실패가 아니다. 창에 `요청을 취소했어요` 를 남기지 않는다
it('오프라인으로 멈춘 사이 세션이 바뀐 끊기는 확인 창에 실패 문구를 남기지 않는다', async () => {
  const client = createQueryClient()
  render(
    <QueryClientProvider client={client}>
      <ConnectionActions workspaceId="ws_01" provider="notion" />
    </QueryClientProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: '연결 끊기' }))
  const dialog = await screen.findByRole('dialog')
  onlineManager.setOnline(false)
  await userEvent.click(within(dialog).getByRole('button', { name: '연결 끊기' }))
  await waitFor(() => expect(client.getMutationCache().getAll().at(-1)?.state.isPaused).toBe(true))

  act(() => advanceSessionGeneration())
  onlineManager.setOnline(true)

  await waitFor(() => expect(client.getMutationCache().getAll().at(-1)?.state.status).toBe('error'))
  expect(within(dialog).queryByRole('alert')).toBeNull()
  expect(within(dialog).queryByText('요청을 취소했어요.')).toBeNull()
})
