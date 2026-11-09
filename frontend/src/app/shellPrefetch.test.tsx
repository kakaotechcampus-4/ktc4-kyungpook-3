import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { http } from 'msw'
import { onTestFinished } from 'vitest'
import { pendingApprovalListQueryOptions } from '@/entities/approval'
import { latestMinutesId, meetingListQueryOptions } from '@/entities/meeting'
import { discordUsersQueryOptions, memberListQueryOptions } from '@/entities/member'
import { messageInboxQueryOptions, messageThreadQueryOptions } from '@/entities/message'
import { minutesQueryOptions } from '@/entities/minutes'
import { taskListQueryOptions } from '@/entities/task'
import { paths } from '@/shared/config/routes'
import { provideScreenCode } from '@/shared/lib/screen-code'
import { fail } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { applyScenario } from '@/shared/mock/scenarios'
import { businessRequests, recordRequests } from '@/shared/test/requests'
import { IDLE_FALLBACK_MS } from './router/shellPrefetch'
import { renderApp } from './test/renderApp'

/*
 * #536 — 셸 탭 다섯 개의 화면 코드와 첫 화면 데이터를 미리 받는다.
 * 탭에 다가간 순간(가리키기·포커스·터치) 그 탭을, 셸이 뜬 뒤 한가할 때 다섯 탭 모두를 받는다. 받은 값은 화면과 같은 Query 의 캐시다.
 * 테스트 setup 은 한가해지지 않는 브라우저(requestIdleCallback 이 부르지 않음)라 한가할 때 받기를 보는 검사만 바꿔 끼운다.
 * 시작 화면은 설정이다 — 다섯 탭의 데이터를 부르지 않는 셸 화면이라 미리 받은 값만 캐시에 남는다.
 */

vi.setConfig({ testTimeout: 10_000 })

const WS = 'ws_01'

// 바꿔 끼운 전역(matchMedia·requestIdleCallback)은 setup 의 beforeEach 가 테스트마다 다시 둔다
afterEach(() => {
  vi.restoreAllMocks()
})

async function openSettings() {
  const app = renderApp(paths.settings(WS))
  await screen.findByRole('heading', { level: 1, name: '설정' })
  return app
}

const tab = (name: string) =>
  within(screen.getAllByRole('navigation', { name: '주요 화면' })[0]).getByRole('link', { name })

const status = (queryClient: QueryClient, queryKey: QueryKey) =>
  queryClient.getQueryState(queryKey)?.status

async function expectCached(queryClient: QueryClient, queryKey: QueryKey) {
  await waitFor(() => expect(status(queryClient, queryKey)).toBe('success'))
}

/** 셸이 부탁한 화면 코드 경로. 앱의 경로 표가 받는 신호 옆에 엿보는 쪽을 붙인다 */
function watchScreenCode() {
  const requested: string[] = []
  onTestFinished(provideScreenCode((path) => requested.push(path)))
  return requested
}

/** 회의록 탭의 기본 선택(가장 최근 회의록)이 열 회의. 미리 받은 회의 목록에서 고른다 */
function latestMinutes(queryClient: QueryClient): string {
  const meetings = queryClient.getQueryData(meetingListQueryOptions(WS).queryKey)
  const id = meetings === undefined ? null : latestMinutesId(meetings)
  if (id === null) throw new Error('no minutes in the mock list')
  return id
}

describe('탭에 다가간 순간 그 탭의 첫 화면 데이터를 받는다', () => {
  it('헤더 탭에 마우스를 올리면 그 화면이 쓰는 조회가 캐시에 들어간다', async () => {
    const app = await openSettings()
    const { queryClient } = app
    expect(status(queryClient, messageInboxQueryOptions(WS).queryKey)).toBeUndefined()
    expect(status(queryClient, taskListQueryOptions(WS).queryKey)).toBeUndefined()

    await userEvent.hover(tab('메시지'))
    await expectCached(queryClient, messageInboxQueryOptions(WS).queryKey)
    await userEvent.hover(tab('태스크'))
    await expectCached(queryClient, taskListQueryOptions(WS).queryKey)
    // PM 화면은 대기 승인을 함께 쓴다
    await expectCached(queryClient, pendingApprovalListQueryOptions(WS).queryKey)
  })

  it('탭에 키보드 포커스가 오면 받는다 — 회의록은 기본 선택이 열 회의록까지, 팀은 Discord 사용자까지', async () => {
    const { queryClient } = await openSettings()

    act(() => tab('회의록').focus())
    await expectCached(queryClient, meetingListQueryOptions(WS).queryKey)
    await expectCached(queryClient, minutesQueryOptions(WS, latestMinutes(queryClient)).queryKey)

    act(() => tab('팀').focus())
    await expectCached(queryClient, memberListQueryOptions(WS).queryKey)
    await expectCached(queryClient, discordUsersQueryOptions(WS).queryKey)
  })

  it('그 탭이 여는 화면의 코드도 받는다', async () => {
    const requested = watchScreenCode()
    await openSettings()
    await userEvent.hover(tab('팀'))
    expect(requested).toContain(paths.members(WS))
  })

  it('팀원은 대기 승인을 받지 않고, 메시지는 넓은 화면이 처음 열 대화까지 받는다', async () => {
    // 팀원 mb_01 이 받은 대화가 있는 세션 (messagesMsw.test.tsx 와 같은 시나리오)
    applyScenario('messages-member')
    const { queryClient } = await openSettings()

    await userEvent.hover(tab('메시지'))
    await expectCached(queryClient, messageInboxQueryOptions(WS).queryKey)
    const inbox = queryClient.getQueryData(messageInboxQueryOptions(WS).queryKey)
    const first = inbox?.threads[0]
    if (first === undefined) throw new Error('member inbox has no thread')
    await expectCached(queryClient, messageThreadQueryOptions(WS, first.id).queryKey)

    await userEvent.hover(tab('태스크'))
    await expectCached(queryClient, taskListQueryOptions(WS).queryKey)
    expect(status(queryClient, pendingApprovalListQueryOptions(WS).queryKey)).toBeUndefined()
  })

  it('휴대폰의 아래 탭 막대는 터치하는 순간 받는다', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 767.98px)',
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }))
    const { queryClient } = await openSettings()
    const bar = await screen.findByRole('navigation', { name: '주요 화면' })
    fireEvent.touchStart(within(bar).getByRole('link', { name: '메시지' }))
    await expectCached(queryClient, messageInboxQueryOptions(WS).queryKey)
  })

  it('실패는 조용히 넘긴다 — 알림 없이 화면이 그대로고, 탭을 열면 화면의 조회가 다시 묻는다', async () => {
    let failing = true
    server.use(
      http.get('/api/v1/workspaces/:workspaceId/messages', () =>
        failing ? fail('INTERNAL', 'boom', 500) : undefined,
      ),
    )
    const { queryClient } = await openSettings()

    await userEvent.hover(tab('메시지'))
    await waitFor(() =>
      expect(status(queryClient, messageInboxQueryOptions(WS).queryKey)).toBe('error'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: '설정' })).toBeInTheDocument()

    failing = false
    await userEvent.click(tab('메시지'))
    expect(await screen.findByRole('heading', { level: 1, name: '메시지' })).toBeInTheDocument()
    await expectCached(queryClient, messageInboxQueryOptions(WS).queryKey)
  })
})

describe('셸이 뜬 뒤 한가할 때 다섯 탭을 한 번 받는다', () => {
  function captureIdle() {
    const callbacks: IdleRequestCallback[] = []
    const request = vi.fn((callback: IdleRequestCallback) => callbacks.push(callback))
    vi.stubGlobal('requestIdleCallback', request)
    return {
      request,
      run: () =>
        act(() => {
          for (const callback of callbacks.splice(0))
            callback({ didTimeout: false, timeRemaining: () => 50 })
        }),
    }
  }

  it('한가해지면 다섯 탭의 첫 화면 데이터와 화면 코드를 받는다', async () => {
    const idle = captureIdle()
    const requested = watchScreenCode()
    const { queryClient } = await openSettings()
    expect(idle.request).toHaveBeenCalledTimes(1)
    expect(status(queryClient, messageInboxQueryOptions(WS).queryKey)).toBeUndefined()

    idle.run()
    for (const queryKey of [
      taskListQueryOptions(WS).queryKey,
      meetingListQueryOptions(WS).queryKey,
      messageInboxQueryOptions(WS).queryKey,
      memberListQueryOptions(WS).queryKey,
      discordUsersQueryOptions(WS).queryKey,
    ])
      await expectCached(queryClient, queryKey)
    await expectCached(queryClient, minutesQueryOptions(WS, latestMinutes(queryClient)).queryKey)
    expect(requested).toEqual([
      paths.dashboard(WS),
      paths.meetings(WS),
      paths.tasks(WS),
      paths.messages(WS),
      paths.members(WS),
    ])
  })

  it('받은 탭으로 처음 옮기면 화면의 조회가 다시 묻지 않는다 — 메시지는 신호 소켓이 열린 뒤 목록을 한 번 맞춘다', async () => {
    const idle = captureIdle()
    const { queryClient } = await openSettings()
    idle.run()
    await expectCached(queryClient, messageInboxQueryOptions(WS).queryKey)
    // 다른 탭의 미리 받기(목록 → 상세 순서로 잇는 것)까지 모두 끝난 뒤부터 적는다
    await waitFor(() => expect(queryClient.isFetching()).toBe(0))

    const requests = recordRequests()
    await userEvent.click(tab('메시지'))
    expect(await screen.findByRole('heading', { level: 1, name: '메시지' })).toBeInTheDocument()
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    // 서버는 소켓이 열리기 전의 신호를 다시 보내지 않아, 미리 받은 목록도 열린 뒤 한 번 다시 받는다 (#558)
    expect(businessRequests(requests.started)).toEqual([
      { method: 'GET', path: `/workspaces/${WS}/messages` },
    ])
  })

  it('requestIdleCallback 이 없는 브라우저는 짧은 타이머 뒤에 받는다', async () => {
    vi.stubGlobal('requestIdleCallback', undefined)
    const { queryClient } = await openSettings()
    await waitFor(
      () => expect(status(queryClient, messageInboxQueryOptions(WS).queryKey)).toBe('success'),
      { timeout: IDLE_FALLBACK_MS + 2000 },
    )
  })

  it('데이터 절약 모드면 한가할 때 받지 않는다 — 탭에 다가간 순간 받기는 그대로다', async () => {
    const idle = captureIdle()
    // jsdom 에는 navigator.connection 이 없다. 이 검사 동안만 붙인다
    Object.defineProperty(navigator, 'connection', {
      value: { saveData: true },
      configurable: true,
    })
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, 'connection')
    })
    const { queryClient } = await openSettings()
    expect(idle.request).not.toHaveBeenCalled()

    await userEvent.hover(tab('메시지'))
    await expectCached(queryClient, messageInboxQueryOptions(WS).queryKey)
  })
})
