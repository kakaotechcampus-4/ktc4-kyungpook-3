import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createQueryClient } from '@/shared/api/queryClient'
import { endSessionScope } from '@/shared/api/sessionScope'
import { recordRequests } from '@/shared/test/requests'
import { captureSavedFiles } from '@/shared/test/savedFiles'
import { GlobalToaster } from '@/shared/ui/toast'
import { SummaryDownloadButton } from './index'

function renderButton() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <GlobalToaster />
      <SummaryDownloadButton meetingId="mt_09" />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const button = () => screen.getByRole('button', { name: /요약본 내려받기|내려받는 중/ })
const summaryRequests = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ path }) => path === '/meetings/mt_09/summary.md')

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('요약본 내려받기 — 세션', () => {
  it('같은 세션이면 요청해 저장한다', async () => {
    const saved = captureSavedFiles()
    const log = recordRequests()
    const user = renderButton()

    await user.click(button())

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(summaryRequests(log)).toHaveLength(1)
  })

  it('오프라인으로 기다리는 사이 세션이 끝나면 다시 연결돼도 요청을 보내지 않고 알리지도 않는다', async () => {
    const saved = captureSavedFiles()
    const log = recordRequests()
    const user = renderButton()

    onlineManager.setOnline(false)
    await user.click(button())
    await waitFor(() => expect(button()).toHaveTextContent('내려받는 중…'))
    act(() => endSessionScope())
    act(() => onlineManager.setOnline(true))

    await waitFor(() => expect(button()).toHaveTextContent('요약본 내려받기'))
    expect(summaryRequests(log)).toEqual([])
    expect(saved).toEqual([])
    expect(screen.queryByText('요약본을 내려받지 못했어요')).toBeNull()
  })
})
