import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { focusManager, onlineManager } from '@tanstack/react-query'
import { HttpResponse, http } from 'msw'
import { expireSession } from '@/app/expireSession'
import {
  clearTrackedMeetings,
  meetingListQueryOptions,
  trackMeeting,
  useMeetingTrackerStore,
} from '@/entities/meeting'
import { PROCESSING_DONE_TITLE, PROCESSING_FAILED_TITLE } from '@/features/meeting-processing'
import { toMinutes } from '@/entities/minutes'
import { workspaceKey } from '@/shared/api/queryKeys'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail, list, ok } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { minutesFixtures } from '@/shared/mock/fixtures/minutes'
import {
  advanceMeeting,
  completeMeeting,
  failMeeting,
  startChatMeeting,
} from '@/shared/mock/meetingFlow'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { businessRequests, recordRequests, trackerRequests } from '@/shared/test/requests'
import { processingSignals, signalsWith } from './test/processingToast'
import { renderApp } from './test/renderApp'

/*
 * M5 U4 — 처리 추적. 실제 경로 표·앱 수준 추적기·MSW handler·request() 를 그대로 탄다.
 * 픽스처의 ws_01 에는 정리 중 회의 mt_10 이 있다. Vitest 의 흐름 방식은 manual 이라 상세 조회가 회의를 진행시키지 않는다 —
 * 테스트가 meetingFlow 의 advanceMeeting·completeMeeting·failMeeting 으로 서버 상태를 직접 바꾼다.
 * 3초 간격은 setInterval 만 가짜로 돌려 단언한다(TanStack Query 의 refetchInterval 이 setInterval 이다).
 */

const MEETING = { workspaceId: 'ws_01', meetingId: 'mt_10' }
const PROCESSING_PATH = paths.meetingProcessing('ws_01', 'mt_10')
const PROCESSING_HEADING = '정리하고 있어요'
const CHAT_STALLED_DESCRIPTION = '채팅 대화를 정리하다 멈췄어요. 다음 수집 때 다시 정리해요.'

afterEach(() => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
  onlineManager.setOnline(true)
  clearTrackedMeetings()
})

type Log = ReturnType<typeof recordRequests>
const detailRequests = (log: Log, meetingId = 'mt_10') =>
  log.started.filter(({ method, path }) => method === 'GET' && path === `/meetings/${meetingId}`)
const listRequests = (log: Log) =>
  log.started.filter(
    ({ method, path }) => method === 'GET' && /^\/workspaces\/[^/]+\/meetings$/.test(path),
  )
const tracked = () => useMeetingTrackerStore.getState().meetings

/** 실제 시간으로 잠깐 기다린다. 「더 오지 않았다」를 볼 때만 쓴다 */
const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 조건이 맞을 때까지 실제 시간으로 기다린다. `vi.waitFor` 는 가짜 타이머를 쓰면 확인할 때마다 시계를 앞으로 돌려
 * polling 이 저절로 더 일어난다 — 간격·횟수를 세는 이 파일에서는 시계를 테스트만 돌린다
 */
async function until<T>(check: () => T, timeout = 3000): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      return check()
    } catch (error) {
      if (Date.now() > deadline) throw error
    }
    await act(() => settle(20))
  }
}

/** setInterval 만 가짜다. MSW·React·userEvent 의 setTimeout 은 그대로 돈다 */
function fakeIntervals() {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
}

/** 두 번째 완료 공간 ws_04. appShell.test.tsx 와 같은 모양이다 */
function addCompletedWorkspace() {
  db.workspaces.push({
    workspace_id: 'ws_04',
    name: '알고리즘 스터디',
    role: 'pm',
    created_at: '2026-09-04T00:00:00Z',
    onboarding: {
      completed: true,
      current_step: null,
      steps: (
        ['create_workspace', 'connect_discord', 'connect_notion', 'connect_members'] as const
      ).map((step) => ({ step, status: 'completed' as const })),
    },
  })
  db.accounts[0].workspaceIds.push('ws_04')
  db.integrations.ws_04 = {
    discord: { status: 'connected', display_name: 'x', connected_at: MOCK_NOW, chat_channel: null },
    notion: { status: 'connected', display_name: 'x', connected_at: MOCK_NOW },
  }
}

async function openDashboard(options: { strict?: boolean } = {}) {
  const app = renderApp(paths.dashboard('ws_01'), options)
  await screen.findByRole('heading', { name: '대시보드' })
  return app
}

/**
 * 회의 조회가 없는 셸 화면(메시지). M7 부터 대시보드가 태스크·승인·회의 상세·추출을 부르므로,
 * 추적기 요청만 따로 세는 테스트는 여기서 시작한다. 메시지 화면은 자기 메시지 조회와 보낼 시각의 재촉 규칙(메시지·알림 설정) 조회만 한다 (quietBusinessRequests)
 */
async function openQuietScreen() {
  const app = renderApp(paths.messages('ws_01'))
  await screen.findByRole('heading', { level: 1, name: '메시지' })
  return app
}

/** 시작 화면(메시지)의 메시지 조회와 메시지·알림 설정 조회를 뺀 업무 요청 */
function quietBusinessRequests(log: ReturnType<typeof recordRequests>) {
  return businessRequests(log.started).filter(
    ({ path }) => !path.includes('/messages') && !path.endsWith('/message-settings'),
  )
}

async function openProcessing(options: { strict?: boolean } = {}) {
  const app = renderApp(PROCESSING_PATH, options)
  await screen.findByRole('heading', { name: PROCESSING_HEADING })
  return app
}

/** 정리 중 진행 토스트. 접힌 알약으로 시작하므로 알약이나 펼친 카드다. 지금 공간·지금 화면에서 보이는 것 */
function processingCard() {
  return (
    screen.queryByRole('region', { name: /정리 중$/ }) ??
    screen.queryByRole('button', { name: /^정리 중.*펼치기$/ })
  )
}

/** 알약을 눌러 펼친 정리 중 카드 */
async function openProcessingCard() {
  fireEvent.click(await screen.findByRole('button', { name: /^정리 중.*펼치기$/ }))
  return screen.findByRole('region', { name: /정리 중$/ })
}

describe('발견과 등록 (U4-1, U4-2)', () => {
  it('지금 공간 목록에서 정리 중 회의를 찾아 진행 토스트를 띄운다 — 헤더 링크는 없고, 업무 요청은 추적기 두 모양뿐이다', async () => {
    const log = recordRequests()
    await openQuietScreen()

    const card = await openProcessingCard()
    expect(card).toHaveTextContent('음성을 텍스트로 옮기고 있어요')
    expect(card).toHaveTextContent('1 / 3 단계 완료')
    const names = within(screen.getByRole('navigation', { name: '주요 화면' }))
      .getAllByRole('link')
      .map((node) => node.textContent)
    expect(names).toEqual(['대시보드', '회의록', '태스크', '메시지', '프로젝트 맵', '팀'])
    expect(tracked()).toEqual([MEETING])
    await waitFor(() => expect(detailRequests(log)).toHaveLength(1))
    await settle()

    // 시작 화면(메시지)은 메시지 조회 밖의 업무 요청이 없다 — 추적기 요청만 남는다
    expect(quietBusinessRequests(log)).toEqual([])
    // 추적기 요청: 지금 공간 목록 1회, 상세는 정리 중 회의에만 1회(다음은 3초 뒤)
    expect(trackerRequests(log.started)).toEqual([
      { method: 'GET', path: '/workspaces/ws_01/meetings' },
      { method: 'GET', path: '/meetings/mt_10' },
    ])
  })

  it('StrictMode 에서도 재렌더·탭 이동이 목록·상세 요청을 늘리지 않는다', async () => {
    fakeIntervals()
    const log = recordRequests()
    const user = userEvent.setup()
    await openDashboard({ strict: true })
    await until(() => expect(detailRequests(log)).toHaveLength(1))
    await settle()
    // 개발용 이중 마운트(StrictMode)는 첫 목록 요청을 취소하고 한 번 더 보낸다 — signal 을 쓰는 조회의 TanStack Query 동작이고,
    // 부팅 조회(/auth/me)도 같다. 제품 빌드에서는 위 테스트처럼 1회다. 그 뒤로는 늘지 않는다
    const lists = listRequests(log).length
    expect(lists).toBeGreaterThanOrEqual(1)
    expect(lists).toBeLessThanOrEqual(2)

    for (const [tab, heading] of [
      ['태스크', '태스크'],
      // M8-B 가 팀 자리표시자를 Team 캔버스 화면으로 바꿨다 — 제목은 `팀` 이다
      ['팀', '팀'],
      ['회의록', '회의록'],
      ['대시보드', '대시보드'],
    ] as const) {
      await user.click(screen.getByRole('link', { name: tab }))
      await screen.findByRole('heading', { name: heading })
    }
    await settle()
    expect(listRequests(log)).toHaveLength(lists)
    expect(detailRequests(log)).toHaveLength(1)
    // U5 부터 회의록 탭은 가장 최근 회의록(mt_09)을 골라 그 회의 상세를 화면이 스스로 부른다(공간 확인, U5-4).
    // 추적기의 polling 이 아니다 — 추적기의 상세는 여전히 정리 중 회의(mt_10)뿐이다
    expect(new Set(trackerRequests(log.started).map(({ path }) => path))).toEqual(
      new Set(['/workspaces/ws_01/meetings', '/meetings/mt_10', '/meetings/mt_09']),
    )
    // StrictMode 로 탭 넷을 차례로 그린다. M8-B 로 팀 탭이 자리표시자에서 실제 화면이 되어 전체 실행 부하에서 5초를 넘겼다
  }, 10_000)

  it('정리 중 회의가 없으면 상세 요청은 0회이고 진행 토스트도 없다', async () => {
    completeMeeting('mt_10')
    const log = recordRequests()
    const app = await openQuietScreen()
    await waitFor(() =>
      expect(app.queryClient.getQueryState(meetingListQueryOptions('ws_01').queryKey)?.status).toBe(
        'success',
      ),
    )
    await settle()
    expect(processingSignals()).toEqual([])
    expect(tracked()).toEqual([])
    expect(listRequests(log)).toEqual([{ method: 'GET', path: '/workspaces/ws_01/meetings' }])
    expect(log.started.filter(({ path }) => path.startsWith('/meetings/'))).toEqual([])
  })

  it('업로드 202 등록 지점만으로 상세 polling 과 진행 토스트가 시작된다 — 목록에 없어도', async () => {
    // 목록이 아직 처리 중 회의를 모른다(업로드 직후). 등록만으로 시작하는지 본다
    server.use(http.get('/api/v1/workspaces/:workspaceId/meetings', () => list([])))
    const log = recordRequests()
    await openDashboard()
    await settle()
    expect(processingSignals()).toEqual([])
    expect(detailRequests(log)).toHaveLength(0)

    act(() => trackMeeting(MEETING))
    await waitFor(() => expect(processingCard()).not.toBeNull())
    await waitFor(() => expect(detailRequests(log)).toHaveLength(1))
  })

  it('다른 화면으로 옮겨도 polling 이 이어지고, 다른 화면에서 끝나면 진행 토스트가 완료로 바뀌고 옮기지 않는다', async () => {
    const user = userEvent.setup()
    const app = await openProcessing({ strict: true })
    await user.click(screen.getByRole('link', { name: '태스크' }))
    await screen.findByRole('heading', { name: '태스크' })

    completeMeeting('mt_10')
    // 다음 polling(3초 안)이 완료를 받는다
    await waitFor(() => expect(signalsWith(PROCESSING_DONE_TITLE)).toHaveLength(1), {
      timeout: 5000,
    })
    await app.expectPath(paths.tasks('ws_01'))
    expect(app.visited().map(({ pathname }) => pathname)).not.toContain(
      paths.meetings('ws_01', 'mt_10'),
    )
    expect(processingCard()).toBeNull()
    expect(processingSignals()).toHaveLength(1)
  }, 10_000)

  it('공간을 바꿔도 끝날 때까지 추적하고, 다른 공간 목록을 돌며 조회하지 않는다', async () => {
    addCompletedWorkspace()
    const log = recordRequests()
    const user = userEvent.setup()
    const app = await openQuietScreen()
    await waitFor(() => expect(processingCard()).not.toBeNull())

    await user.click(await screen.findByRole('button', { name: /^워크스페이스 바꾸기/ }))
    await user.click(
      within(await screen.findByRole('menu', { name: /^워크스페이스 바꾸기/ })).getByRole(
        'menuitem',
        { name: /알고리즘 스터디/ },
      ),
    )
    await app.expectPath(paths.dashboard('ws_04'))
    // ws_04 에는 정리 중 회의가 없다 — 이 공간에는 진행 토스트가 없지만 ws_01 의 추적은 남는다 (D-088)
    await waitFor(() =>
      expect(listRequests(log).map(({ path }) => path)).toContain('/workspaces/ws_04/meetings'),
    )
    expect(processingSignals()).toEqual([])
    expect(tracked()).toEqual([MEETING])

    completeMeeting('mt_10')
    await waitFor(() => expect(tracked()).toEqual([]), { timeout: 5000 })
    await app.expectPath(paths.dashboard('ws_04'))
    // 끝난 결과도 그 회의의 공간에서만 보인다
    expect(processingSignals()).toEqual([])
    expect(useMeetingTrackerStore.getState().settled).toMatchObject([
      { ...MEETING, outcome: 'done' },
    ])
    // 본 공간의 목록만 받았다 — 소속된 ws_02 목록은 한 번도 묻지 않았다
    expect(new Set(listRequests(log).map(({ path }) => path))).toEqual(
      new Set(['/workspaces/ws_01/meetings', '/workspaces/ws_04/meetings']),
    )
    expect(detailRequests(log).length).toBeGreaterThan(0)
    expect(
      log.started.filter(({ path }) => path.startsWith('/meetings/') && path !== '/meetings/mt_10'),
    ).toEqual([])
  }, 10_000)

  it('새로고침하면 지금 공간 목록으로 다시 찾는다 — 추적 목록은 저장하지 않는다', async () => {
    const first = await openDashboard()
    await waitFor(() => expect(tracked()).toEqual([MEETING]))
    expect(sessionStorage.length + localStorage.length).toBe(0)

    // 새로고침: 화면과 메모리(store)가 사라지고 앱을 처음부터 다시 띄운다
    first.unmount()
    clearTrackedMeetings()
    const log = recordRequests()
    renderApp(paths.tasks('ws_01'))
    await screen.findByRole('heading', { name: '태스크' })
    await waitFor(() => expect(processingCard()).not.toBeNull())
    expect(listRequests(log)).toEqual([{ method: 'GET', path: '/workspaces/ws_01/meetings' }])
  })

  it('추적 상태에는 ID 만 있다 — 회의 객체는 Query 캐시에만 있다 (G5)', async () => {
    const app = await openDashboard()
    await waitFor(() => expect(tracked()).toHaveLength(1))
    const state = useMeetingTrackerStore.getState()
    expect(Object.keys(state.meetings[0]).sort()).toEqual(['meetingId', 'workspaceId'])
    await waitFor(() =>
      expect(
        app.queryClient.getQueryData(workspaceKey('ws_01', 'meetings', 'detail', 'mt_10')),
      ).toMatchObject({ id: 'mt_10', status: 'processing' }),
    )
  })
})

describe('polling (U4-3)', () => {
  it('상세는 3초 간격으로, 정리 중일 때만 묻는다 — 완료되면 멈춘다', async () => {
    fakeIntervals()
    const log = recordRequests()
    await openDashboard()
    await until(() => expect(detailRequests(log)).toHaveLength(1))

    await act(() => vi.advanceTimersByTimeAsync(2_999))
    await settle()
    expect(detailRequests(log)).toHaveLength(1)
    await act(() => vi.advanceTimersByTimeAsync(1))
    await until(() => expect(detailRequests(log)).toHaveLength(2))
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await until(() => expect(detailRequests(log)).toHaveLength(3))

    completeMeeting('mt_10')
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await until(() => expect(detailRequests(log)).toHaveLength(4))
    await until(() => expect(signalsWith(PROCESSING_DONE_TITLE)).toHaveLength(1))

    // 끝난 뒤에는 시간이 흘러도 묻지 않는다
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    await settle()
    expect(detailRequests(log)).toHaveLength(4)
    expect(tracked()).toEqual([])
  })

  it('실패하면 멈춘다', async () => {
    fakeIntervals()
    const log = recordRequests()
    await openDashboard()
    await until(() => expect(detailRequests(log)).toHaveLength(1))

    failMeeting('mt_10')
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await until(() => expect(signalsWith(PROCESSING_FAILED_TITLE)).toHaveLength(1))
    const count = detailRequests(log).length
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    await settle()
    expect(detailRequests(log)).toHaveLength(count)
  })

  it.each([
    [403, 'FORBIDDEN'],
    [404, 'MEETING_NOT_FOUND'],
  ])(
    '%i 이면 접근 권한을 잃은 것이다 — 알림·이동 없이 멈추고 추적에서 뺀다',
    async (status, code) => {
      fakeIntervals()
      const log = recordRequests()
      const app = await openDashboard()
      await until(() => expect(detailRequests(log)).toHaveLength(1))

      server.use(http.get('/api/v1/meetings/:meetingId', () => fail(code, code, status)))
      await act(() => vi.advanceTimersByTimeAsync(3_000))
      await until(() => expect(tracked()).toEqual([]))
      await act(() => vi.advanceTimersByTimeAsync(15_000))
      await settle()
      // 다시 묻지 않는다(재시도 대상도 아니다)
      expect(detailRequests(log)).toHaveLength(2)
      expect(document.querySelectorAll('[data-toast-key]')).toHaveLength(0)
      expect(processingSignals()).toEqual([])
      await app.expectPath(paths.dashboard('ws_01'))
    },
  )

  it('로그아웃하면 추적을 비우고 polling 이 멈춘다', async () => {
    const log = recordRequests()
    const user = userEvent.setup()
    const app = await openDashboard()
    await waitFor(() => expect(detailRequests(log)).toHaveLength(1))

    await user.click(screen.getByRole('button', { name: /^내 계정/ }))
    await user.click(await screen.findByRole('menuitem', { name: '로그아웃' }))
    await screen.findByRole('heading', { name: '로그인' })
    await app.expectPath('/login')
    expect(useMeetingTrackerStore.getState()).toEqual({
      meetings: [],
      finished: [],
      prompted: [],
      settled: [],
      dismissed: [],
    })

    // 다음 polling 시점이 지나도 이전 사용자의 회의를 묻지 않는다
    completeMeeting('mt_10')
    await settle(3_500)
    const after = log.timeline.indexOf('answer POST /auth/logout')
    expect(
      log.timeline.slice(after + 1).filter((line) => line.startsWith('start GET /meetings/')),
    ).toEqual([])
    expect(processingSignals()).toEqual([])
  }, 10_000)

  it('세션이 만료되어도 추적을 비운다', async () => {
    const app = await openDashboard()
    await waitFor(() => expect(tracked()).toEqual([MEETING]))
    act(() => {
      expireSession(app.queryClient)
    })
    await screen.findByRole('heading', { name: '로그인' })
    expect(useMeetingTrackerStore.getState()).toEqual({
      meetings: [],
      finished: [],
      prompted: [],
      settled: [],
      dismissed: [],
    })
  })
})

describe('처리 화면 (U4-4, U4-10)', () => {
  it('서버의 progress 세 값을 단계로만 보인다 — 백분율·남은 시간·진행 막대가 없다', async () => {
    await openProcessing()
    const steps = within(screen.getByRole('list', { name: '정리 단계' })).getAllByRole('listitem')
    expect(steps.map((step) => step.textContent)).toEqual([
      '차례 기다리는 중완료',
      '음성을 텍스트로 옮기기진행 중',
      '결정사항과 할 일 뽑아내기대기',
    ])
    expect(steps[1]).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 / 3 단계 완료 · 음성을 텍스트로 옮기기 진행 중',
    )
    const main = screen.getByRole('main')
    expect(main.textContent).not.toMatch(/%|남은|경과|분 후|초 후/)
    expect(screen.queryByRole('progressbar')).toBeNull()
    // 범위 밖 캔버스 요소(원본 재생·중단)가 없다
    expect(screen.queryByRole('button', { name: /들어보기|중단하기/ })).toBeNull()
    // Notion 반영 안내 — 회의록 본문은 올리지 않는다. 기본 역할 PM 은 승인 문장까지 본다 (D-101, 2026-11-07)
    expect(main).toHaveTextContent(
      'Notion을 연결했다면 확실한 태스크는 바로, 확인이 필요한 태스크는 승인한 뒤 Notion에도 올라가요.',
    )
    expect(main).not.toHaveTextContent('회의록과')
  })

  it('일반 팀원은 승인 문장 없이 확실한 태스크만 Notion에 올라간다는 안내를 본다', async () => {
    setMockRole('member')
    await openProcessing()
    const main = screen.getByRole('main')
    await waitFor(() =>
      expect(main).toHaveTextContent(
        'Notion을 연결했다면 확실한 태스크는 바로 Notion에도 올라가요.',
      ),
    )
    expect(main).not.toHaveTextContent('승인한 뒤')
  })

  it('아직 끝난 단계가 없으면 정리하고 있다는 제목과 0 / 3 단계 완료를 알린다', async () => {
    db.meetings.find(({ meeting_id }) => meeting_id === 'mt_10')!.progress = {
      audio_merged: false,
      transcribed: false,
      extracted: false,
    }
    await openProcessing()
    expect(screen.getByRole('status')).toHaveTextContent('0 / 3 단계 완료')
  })

  it('단계가 바뀌면 role="status" 안내가 바뀐다 (U4-10)', async () => {
    fakeIntervals()
    await openProcessing()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('1 / 3 단계 완료')

    advanceMeeting('mt_10')
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await until(() =>
      expect(status).toHaveTextContent('2 / 3 단계 완료 · 결정사항과 할 일 뽑아내기 진행 중'),
    )
    // 같은 안내 요소가 남아 갱신된다 — 스크린리더가 바뀐 내용을 읽는다
    expect(screen.getByRole('status')).toBe(status)
  })

  it('PM 이 정리 중에 회의 올리기로 가면 지금 처리 화면으로 간다 (D-090)', async () => {
    setMockRole('pm')
    const app = await openDashboard()
    await waitFor(() => expect(processingCard()).not.toBeNull())
    act(() => app.navigate(paths.meetingUpload('ws_01')))
    expect(await screen.findByRole('heading', { name: PROCESSING_HEADING })).toBeInTheDocument()
    await app.expectPath(PROCESSING_PATH)
    expect(screen.queryByRole('heading', { name: '회의를 올려 주세요' })).toBeNull()
  })

  it('진행 토스트의 `자세히 보기` 로 일반 팀원도 처리 화면에 가고, 처리 화면에서는 토스트를 숨긴다 (U4-9)', async () => {
    setMockRole('member')
    const user = userEvent.setup()
    const app = renderApp(paths.tasks('ws_01'))
    await screen.findByRole('heading', { name: '태스크' })
    const card = await openProcessingCard()
    await user.click(within(card).getByRole('button', { name: '자세히 보기' }))
    expect(await screen.findByRole('heading', { name: PROCESSING_HEADING })).toBeInTheDocument()
    await app.expectPath(PROCESSING_PATH)
    expect(processingSignals()).toEqual([])
  })

  it('목록이 모르는 정리 중 회의(직접 링크)도 처리 화면에 들어오면 추적에 등록한다', async () => {
    server.use(http.get('/api/v1/workspaces/:workspaceId/meetings', () => list([])))
    await openProcessing()
    await waitFor(() => expect(tracked()).toEqual([MEETING]))
  })

  it('처음 상세 조회가 실패하면 불러오지 못했다고 알리고 다시 시도를 준다', async () => {
    server.use(http.get('/api/v1/meetings/:meetingId', () => fail('INVALID_REQUEST', 'x', 400)))
    renderApp(PROCESSING_PATH)
    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('정리 상태를 불러오지 못했어요')
  })

  it('볼 수 없는 회의는 안내를 보인다', async () => {
    server.use(
      http.get('/api/v1/meetings/:meetingId', () =>
        fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404),
      ),
    )
    renderApp(PROCESSING_PATH)
    expect(
      await screen.findByRole('heading', { name: '이 회의를 볼 수 없어요' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '회의록으로 가기' })).toHaveAttribute(
      'href',
      paths.meetings('ws_01'),
    )
  })

  it('다른 공간의 회의 ID 로 들어오면 그 회의를 보이지 않는다', async () => {
    addCompletedWorkspace()
    renderApp(paths.meetingProcessing('ws_04', 'mt_10'))
    expect(
      await screen.findByRole('heading', { name: '이 회의를 볼 수 없어요' }),
    ).toBeInTheDocument()
  })
})

describe('완료 (U4-5)', () => {
  it('처리 화면을 보고 있으면 끝났을 때 그 회의록으로 옮기고, 관련 캐시를 무효화하고, 완료 토스트는 하나다', async () => {
    fakeIntervals()
    const app = await openProcessing({ strict: true })
    // 끝나면 다시 받아야 할 캐시 — 회의록·추출·태스크·승인.
    // U5 부터 옮겨 간 회의록 화면이 회의록 본문·대기 승인 캐시를 읽어 그린다. 그 둘은 화면이 그릴 수 있는 모양으로 넣는다
    const related = [
      [
        workspaceKey('ws_01', 'minutes', 'mt_10'),
        toMinutes({ ...minutesFixtures[1], meeting_id: 'mt_10', title: '이전 회의록' }),
      ],
      [workspaceKey('ws_01', 'extractions', 'ex_99'), { cached: true }],
      [workspaceKey('ws_01', 'tasks', 'list'), { cached: true }],
      [workspaceKey('ws_01', 'approvals', { status: 'pending' }), []],
    ] as const
    for (const [key, value] of related) app.queryClient.setQueryData(key, value)

    completeMeeting('mt_10')
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await until(() => expect(app.visited().at(-1)?.pathname).toBe(paths.meetings('ws_01', 'mt_10')))
    expect(await screen.findByRole('heading', { name: '회의록' })).toBeInTheDocument()
    // 처리 화면은 기록에서 바뀌었다 — 뒤로 가도 끝난 처리 화면으로 돌아오지 않는다
    expect(app.visited().at(-1)?.key).not.toBe(app.visited().at(-2)?.key)

    await until(() => expect(signalsWith(PROCESSING_DONE_TITLE)).toHaveLength(1))
    const doneToast = signalsWith(PROCESSING_DONE_TITLE)[0]
    expect(within(doneToast).getByRole('button', { name: '회의록 보기' })).toBeInTheDocument()
    expect(processingSignals()).toHaveLength(1)
    expect(document.querySelectorAll('[data-toast-key]')).toHaveLength(0)
    // 무효화됐다. 회의록 화면이 지켜보는 key(본문·승인)는 무효화되자마자 다시 받아 넣어 둔 값이 서버 값으로 바뀐다 —
    // 무효화 없이는 최신 시간(5분·30초) 안이라 다시 받지 않는다. 지켜보지 않는 key 는 무효화된 채로 남는다
    for (const [key, value] of related)
      await until(() =>
        expect(
          app.queryClient.getQueryState(key)?.isInvalidated === true ||
            app.queryClient.getQueryData(key) !== value,
        ).toBe(true),
      )
    expect(
      app.queryClient.getQueryState(meetingListQueryOptions('ws_01').queryKey)?.dataUpdatedAt,
    ).toBeGreaterThan(0)
  })

  it('재렌더·재발견·탭 이동에도 완료 토스트는 회의마다 한 번이다 — 닫은 뒤 다시 뜨지 않는다', async () => {
    const user = userEvent.setup()
    const app = await openDashboard({ strict: true })
    await waitFor(() => expect(tracked()).toEqual([MEETING]))

    completeMeeting('mt_10')
    const doneToast = await waitFor(
      () => {
        expect(signalsWith(PROCESSING_DONE_TITLE)).toHaveLength(1)
        return signalsWith(PROCESSING_DONE_TITLE)[0]
      },
      { timeout: 5000 },
    )
    await user.click(within(doneToast).getByRole('button', { name: '닫기' }))
    expect(processingSignals()).toEqual([])

    // 낡은 목록이 같은 회의를 다시 「정리 중」으로 보여 준다 — 다시 등록되지 않는다
    act(() => {
      app.queryClient.setQueryData(
        meetingListQueryOptions('ws_01').queryKey,
        (meetings) =>
          meetings?.map((meeting) =>
            meeting.id === 'mt_10' ? { ...meeting, status: 'processing' as const } : meeting,
          ) ?? [],
      )
    })
    for (const tab of ['태스크', '회의록', '팀', '대시보드']) {
      await user.click(screen.getByRole('link', { name: tab }))
      await settle(30)
    }
    act(() => trackMeeting(MEETING))
    await settle(300)

    expect(tracked()).toEqual([])
    expect(processingSignals()).toEqual([])
  }, 10_000)

  it('토스트의 `회의록 보기` 는 방금 끝난 회의록으로 가고 토스트를 닫는다', async () => {
    fakeIntervals()
    const app = await openDashboard()
    await until(() => expect(tracked()).toEqual([MEETING]))
    completeMeeting('mt_10')
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    const button = await until(() =>
      within(signalsWith(PROCESSING_DONE_TITLE)[0]).getByRole('button', { name: '회의록 보기' }),
    )
    // 대시보드는 그대로였다 — 보던 화면이 처리 화면이 아니었다
    expect(app.visited().map(({ pathname }) => pathname)).toEqual([paths.dashboard('ws_01')])

    fireEvent.click(button)
    await until(() => expect(app.visited().at(-1)?.pathname).toBe(paths.meetings('ws_01', 'mt_10')))
    expect(processingSignals()).toEqual([])
  })
})

describe('실패 (U4-6, U4-7)', () => {
  it('다른 화면에서 만료되면 이동하지 않고 알리며 목록의 만료 이력은 유지한다', async () => {
    fakeIntervals()
    const app = renderApp(paths.tasks('ws_01'))
    await screen.findByRole('heading', { name: '태스크' })
    await until(() => expect(tracked()).toEqual([MEETING]))
    failMeeting('mt_10', { failedStage: 'speaker_assignment_expired' })
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await until(() =>
      expect(
        app.queryClient
          .getQueryData(meetingListQueryOptions('ws_01').queryKey)
          ?.find(({ id }) => id === 'mt_10'),
      ).toMatchObject({ status: 'failed', failedStage: 'speaker_assignment_expired' }),
    )
    expect(app.visited().map(({ pathname }) => pathname)).toEqual([paths.tasks('ws_01')])
    expect(tracked()).toEqual([])
    expect(signalsWith('화자 지정 대기가 7일을 넘어')).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('채팅 회의가 멈춰 실패하면(chat_stalled) 토스트가 다시 올리라고 하지 않는다 (#450)', async () => {
    fakeIntervals()
    const chatId = startChatMeeting()
    const log = recordRequests()
    const app = renderApp(paths.tasks('ws_01'))
    await screen.findByRole('heading', { name: '태스크' })
    await until(() => expect(tracked()).toContainEqual({ workspaceId: 'ws_01', meetingId: chatId }))
    failMeeting(chatId, { failedStage: 'chat_stalled' })
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await until(() => expect(signalsWith(CHAT_STALLED_DESCRIPTION)).toHaveLength(1))
    expect(signalsWith('다시 올려')).toEqual([])
    // 알려진 사유라 Notion 끊김인지 묻지 않는다
    expect(log.started).not.toContainEqual({
      method: 'GET',
      path: '/workspaces/ws_01/integrations',
    })
    expect(app.visited().map(({ pathname }) => pathname)).toEqual([paths.tasks('ws_01')])
  })

  it('멈춘 채팅 회의(chat_stalled)의 처리 화면은 다시 올리라고 하지 않는다 (#450)', async () => {
    const chatId = startChatMeeting()
    failMeeting(chatId, { failedStage: 'chat_stalled' })
    renderApp(paths.meetingProcessing('ws_01', chatId))
    expect(
      await screen.findByRole('heading', { name: '채팅 대화를 정리하지 못했어요' }),
    ).toBeInTheDocument()
    expect(screen.getByText(CHAT_STALLED_DESCRIPTION)).toBeInTheDocument()
    expect(screen.queryByText(/다시 올려/)).toBeNull()
  })

  it('처리 화면을 보고 있으면 회의록 목록으로 옮기고 재업로드 안내 토스트로 바꾼다 — 실패 회의는 목록에서 빠진다', async () => {
    fakeIntervals()
    const app = await openProcessing({ strict: true })

    failMeeting('mt_10')
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    // 회의록 목록으로 옮겼다. U5 부터 목록은 가장 최근 회의록(mt_09)으로 주소를 바꾼다 (D-106, U5-1)
    await until(() => expect(app.visited().at(-1)?.pathname).toBe(paths.meetings('ws_01', 'mt_09')))
    expect(app.visited().map(({ pathname }) => pathname)).toContain(paths.meetings('ws_01'))
    await until(() => expect(signalsWith(PROCESSING_FAILED_TITLE)).toHaveLength(1))
    expect(signalsWith(PROCESSING_FAILED_TITLE)[0]).toHaveTextContent('파일을 다시 올려 주세요.')
    expect(screen.queryByRole('dialog')).toBeNull()
    await until(() =>
      expect(
        app.queryClient
          .getQueryData(meetingListQueryOptions('ws_01').queryKey)
          ?.map(({ id }) => id),
      ).toEqual(['mt_09', 'mt_08', 'mt_07']),
    )
    expect(tracked()).toEqual([])
  })

  it('처리 화면을 보다가 정리 시작 기한이 지나면(upload_unclaimed) 그 회의 상세로 옮기고 목록의 이력을 유지한다 (#598)', async () => {
    fakeIntervals()
    const app = await openProcessing({ strict: true })

    failMeeting('mt_10', { failedStage: 'upload_unclaimed' })
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await until(() => expect(app.visited().at(-1)?.pathname).toBe(paths.meetings('ws_01', 'mt_10')))
    await until(() =>
      expect(
        app.queryClient
          .getQueryData(meetingListQueryOptions('ws_01').queryKey)
          ?.find(({ id }) => id === 'mt_10'),
      ).toMatchObject({ status: 'failed', failedStage: 'upload_unclaimed' }),
    )
    expect(signalsWith('업로드 뒤 24시간 동안 정리가 시작되지 않아')).toHaveLength(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(tracked()).toEqual([])
  })

  it('다른 화면을 보고 있으면 토스트만 띄우고 옮기지 않는다', async () => {
    fakeIntervals()
    const app = renderApp(paths.tasks('ws_01'))
    await screen.findByRole('heading', { name: '태스크' })
    await until(() => expect(tracked()).toEqual([MEETING]))

    failMeeting('mt_10')
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await until(() => expect(signalsWith(PROCESSING_FAILED_TITLE)).toHaveLength(1))
    await settle()
    expect(app.visited().map(({ pathname }) => pathname)).toEqual([paths.tasks('ws_01')])
  })

  it('Notion 연결이 실패(revoked)한 공간에서 정리가 실패해도 재연결 모달 없이 재업로드 안내다 (D-182)', async () => {
    fakeIntervals()
    db.integrations.ws_01.notion = { ...db.integrations.ws_01.notion, status: 'revoked' }
    const app = await openProcessing()

    failMeeting('mt_10')
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await until(() => expect(app.visited().at(-1)?.pathname).toBe(paths.meetings('ws_01', 'mt_09')))
    await until(() => expect(signalsWith(PROCESSING_FAILED_TITLE)).toHaveLength(1))
    expect(signalsWith(PROCESSING_FAILED_TITLE)[0]).toHaveTextContent('파일을 다시 올려 주세요.')
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(app.visited().map(({ pathname }) => pathname)).not.toContain(paths.settings('ws_01'))
  })
})

describe('일시적 조회 오류 (U4-8)', () => {
  it.each([
    [
      '창 포커스',
      () => {
        focusManager.setFocused(false)
        focusManager.setFocused(true)
      },
    ],
    [
      '온라인 복귀',
      () => {
        onlineManager.setOnline(false)
        onlineManager.setOnline(true)
      },
    ],
  ])(
    '네트워크 오류는 정리 실패가 아니다 — 토스트·이동 없이 기다렸다가 %s 때 다시 묻는다',
    async (_label, reconnect) => {
      fakeIntervals()
      let offline = false
      server.use(
        http.get('/api/v1/meetings/:meetingId', () => (offline ? HttpResponse.error() : undefined)),
      )
      const log = recordRequests()
      const app = await openProcessing()
      await until(() => expect(detailRequests(log)).toHaveLength(1))

      offline = true
      await act(() => vi.advanceTimersByTimeAsync(3_000))
      // 실패 뒤 1초 뒤 한 번 더(기본 재시도) — 둘 다 응답을 받지 못했다
      expect(
        await screen.findByText(
          '연결이 불안정해요. 다시 연결되면 정리 상태를 바로 확인할게요.',
          {},
          { timeout: 3000 },
        ),
      ).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: PROCESSING_HEADING })).toBeInTheDocument()
      expect(document.querySelectorAll('[data-toast-key]')).toHaveLength(0)
      expect(app.visited().map(({ pathname }) => pathname)).toEqual([PROCESSING_PATH])
      expect(tracked()).toEqual([MEETING])
      const before = detailRequests(log).length

      // 연결이 돌아오는 사이에 정리가 끝났다. 간격을 기다리지 않고 바로 묻는다
      offline = false
      completeMeeting('mt_10')
      act(reconnect)
      await until(() => expect(detailRequests(log).length).toBeGreaterThan(before))
      await until(() =>
        expect(app.visited().at(-1)?.pathname).toBe(paths.meetings('ws_01', 'mt_10')),
      )
      await until(() => expect(signalsWith(PROCESSING_DONE_TITLE)).toHaveLength(1))
    },
    10_000,
  )
})

describe('상세가 다른 공간의 회의라고 답할 때 (#349)', () => {
  const otherWorkspace = () =>
    http.get('/api/v1/meetings/mt_10', () => {
      const meeting = db.meetings.find(({ meeting_id }) => meeting_id === 'mt_10')!
      return ok({ ...meeting, workspace_id: 'ws_02' })
    })

  it('처리 화면은 받아 둔 정리 중 상태가 있어도 다시 받은 상세가 다른 공간이면 볼 수 없는 회의로 바꾼다', async () => {
    const app = await openProcessing()
    server.use(otherWorkspace())
    await act(() =>
      app.queryClient.invalidateQueries({
        queryKey: workspaceKey('ws_01', 'meetings', 'detail', 'mt_10'),
      }),
    )
    expect(
      await screen.findByRole('heading', { name: '이 회의를 볼 수 없어요' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: PROCESSING_HEADING })).toBeNull()
  })

  it('받아 둔 상태가 없으면 알림 없이 추적을 끝내고 더 묻지 않는다', async () => {
    fakeIntervals()
    server.use(otherWorkspace())
    const log = recordRequests()
    await openQuietScreen()
    act(() => trackMeeting(MEETING))
    await until(() => expect(detailRequests(log)).toHaveLength(1))
    await until(() => expect(tracked()).toEqual([]))

    await act(() => vi.advanceTimersByTimeAsync(9_000))
    await settle()
    expect(detailRequests(log)).toHaveLength(1)
    expect(document.querySelectorAll('[data-toast-key]')).toHaveLength(0)
    expect(processingSignals()).toEqual([])
  })

  it('받아 둔 정리 중 상태가 있으면 그 상태로 계속 지켜보고, 바른 답이 오면 끝을 알린다', async () => {
    fakeIntervals()
    const log = recordRequests()
    await openQuietScreen()
    act(() => trackMeeting(MEETING))
    await until(() => expect(detailRequests(log)).toHaveLength(1))

    server.use(otherWorkspace())
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await until(() => expect(detailRequests(log)).toHaveLength(2))
    await settle()
    expect(tracked()).toEqual([MEETING])
    expect(document.querySelectorAll('[data-toast-key]')).toHaveLength(0)

    server.resetHandlers()
    completeMeeting('mt_10')
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await until(() => expect(detailRequests(log)).toHaveLength(3))
    await until(() => expect(signalsWith(PROCESSING_DONE_TITLE)).toHaveLength(1))
    expect(tracked()).toEqual([])
  })
})

describe('받아 둔 상세 뒤 403·404 (#405)', () => {
  const refusal = (status: 403 | 404) =>
    http.get('/api/v1/meetings/mt_10', () =>
      status === 404
        ? fail('MEETING_NOT_FOUND', '회의가 없습니다.', 404)
        : fail('FORBIDDEN', '이 작업을 수행할 권한이 없습니다.', 403),
    )

  it.each([403, 404] as const)(
    '처리 화면을 보는 중 polling 이 %i 를 받으면 마지막 정리 중 상태에 멈추지 않고 볼 수 없는 회의로 바꾸고 더 묻지 않는다',
    async (status) => {
      fakeIntervals()
      const log = recordRequests()
      await openProcessing()
      await until(() => expect(detailRequests(log)).toHaveLength(1))

      server.use(refusal(status))
      await act(() => vi.advanceTimersByTimeAsync(3_000))
      await until(() => expect(detailRequests(log)).toHaveLength(2))
      await until(() => expect(tracked()).toEqual([]))
      expect(
        await screen.findByRole('heading', { name: '이 회의를 볼 수 없어요' }),
      ).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: PROCESSING_HEADING })).toBeNull()

      await act(() => vi.advanceTimersByTimeAsync(9_000))
      await settle()
      expect(detailRequests(log)).toHaveLength(2)
      expect(document.querySelectorAll('[data-toast-key]')).toHaveLength(0)
    },
  )
})
