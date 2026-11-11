import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { createQueryClient } from '@/shared/api/queryClient'
import { endSessionScope } from '@/shared/api/sessionScope'
import { fail } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { recordRequests } from '@/shared/test/requests'
import { captureSavedFiles } from '@/shared/test/savedFiles'
import { GlobalToaster } from '@/shared/ui/toast'
import { ProjectBundleDownload } from './index'

const BUNDLE = '/api/v1/workspaces/ws_01/project-bundle.md'

function renderDownload() {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <GlobalToaster />
      <ProjectBundleDownload workspaceId="ws_01" />
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const bundleRequests = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ path }) => path.startsWith('/workspaces/ws_01/project-bundle.md'))

const button = () => screen.getByRole('button', { name: /프로젝트 내려받기|내려받는 중/ })

afterEach(() => {
  onlineManager.setOnline(true)
})

describe('프로젝트 합본 내려받기', () => {
  it('기본은 전체 기간이고 기간 없이 요청해 서버가 정한 한글 이름으로 저장한다', async () => {
    const saved = captureSavedFiles()
    const log = recordRequests()
    const user = renderDownload()

    expect(screen.getByText('전체 기간')).toBeInTheDocument()
    expect(
      screen.getByText('팀원 발언 요약이 들어 있어요. 외부 AI 에 첨부할 때 주의해 주세요.'),
    ).toBeInTheDocument()
    await user.click(button())

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(bundleRequests(log).map(({ path }) => path)).toEqual([
      '/workspaces/ws_01/project-bundle.md',
    ])
    expect(saved[0].filename).toBe('카테캠 3팀 프로젝트 맥락 2026-09-18.md')
    expect(saved[0].type).toBe('text/markdown;charset=utf-8')
    expect(await saved[0].text()).toContain('# ')
  })

  it('일반 팀원도 내려받는다', async () => {
    setMockRole('member')
    const saved = captureSavedFiles()
    const user = renderDownload()
    await user.click(button())
    await waitFor(() => expect(saved).toHaveLength(1))
  })

  it('적은 날짜만 from·to 로 보내고 기간을 글로 보인다', async () => {
    const saved = captureSavedFiles()
    const log = recordRequests()
    const user = renderDownload()

    await user.type(screen.getByLabelText('시작일'), '2026-09-10')
    expect(screen.getByText('2026-09-10부터')).toBeInTheDocument()
    await user.type(screen.getByLabelText('종료일'), '2026-09-16')
    expect(screen.getByText('2026-09-10 ~ 2026-09-16')).toBeInTheDocument()
    await user.click(button())

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(bundleRequests(log).map(({ path }) => path)).toEqual([
      '/workspaces/ws_01/project-bundle.md?from=2026-09-10&to=2026-09-16',
    ])
  })

  it('시작일이 종료일보다 늦으면 보내지 않고 그 자리에서 알린다. 고치면 문구가 사라진다', async () => {
    const log = recordRequests()
    const user = renderDownload()

    await user.type(screen.getByLabelText('시작일'), '2026-09-20')
    await user.type(screen.getByLabelText('종료일'), '2026-09-10')
    await user.click(button())

    expect(screen.getByRole('alert')).toHaveTextContent('시작일이 종료일보다 늦어요.')
    expect(bundleRequests(log)).toEqual([])
    await user.clear(screen.getByLabelText('시작일'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('형식이 틀린 날짜는 그 칸에 알리고 보내지 않는다', async () => {
    const log = recordRequests()
    const user = renderDownload()

    await user.type(screen.getByLabelText('종료일'), '9월 말')
    await user.click(button())

    expect(screen.getByLabelText('종료일')).toHaveAccessibleDescription(
      'YYYY-MM-DD 형식의 있는 날짜로 적어 주세요.',
    )
    expect(bundleRequests(log)).toEqual([])
  })

  it('서버가 기간을 거절하면(400 INVALID_REQUEST) 같은 문구를 그 자리에 보인다', async () => {
    server.use(http.get(BUNDLE, () => fail('INVALID_REQUEST', 'from 이 to 보다 늦습니다.', 400)))
    const saved = captureSavedFiles()
    const user = renderDownload()

    await user.click(button())

    expect(await screen.findByRole('alert')).toHaveTextContent('시작일이 종료일보다 늦어요.')
    expect(saved).toEqual([])
  })

  it('그 밖의 실패는 알림으로 알리고 다시 누를 수 있다', async () => {
    server.use(http.get(BUNDLE, () => fail('FORBIDDEN', '권한이 없습니다.', 403)))
    const user = renderDownload()

    await user.click(button())

    expect(await screen.findByText('프로젝트 합본을 내려받지 못했어요')).toBeInTheDocument()
    expect(screen.getByText('접근 권한이 없어요.')).toBeInTheDocument()
    expect(button()).toBeEnabled()
    expect(button()).toHaveTextContent('프로젝트 내려받기')
  })

  it('받는 동안 버튼이 잠기고 내려받는 중이라고 말한다', async () => {
    let release = () => {}
    server.use(
      http.get(BUNDLE, async () => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return fail('INTERNAL_ERROR', 'boom', 500)
      }),
    )
    const user = renderDownload()

    await user.click(button())

    await waitFor(() => expect(button()).toHaveTextContent('내려받는 중…'))
    expect(button()).toBeDisabled()
    release()
    await waitFor(() => expect(button()).toHaveTextContent('프로젝트 내려받기'))
  })

  it('오프라인으로 기다리는 사이 세션이 끝나면 다시 연결돼도 요청을 보내지 않고 알리지도 않는다', async () => {
    const saved = captureSavedFiles()
    const log = recordRequests()
    const user = renderDownload()

    onlineManager.setOnline(false)
    await user.click(button())
    await waitFor(() => expect(button()).toHaveTextContent('내려받는 중…'))
    act(() => endSessionScope())
    act(() => onlineManager.setOnline(true))

    await waitFor(() => expect(button()).toHaveTextContent('프로젝트 내려받기'))
    expect(bundleRequests(log)).toEqual([])
    expect(saved).toEqual([])
    expect(screen.queryByText('프로젝트 합본을 내려받지 못했어요')).toBeNull()
  })
})
