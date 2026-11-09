import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { onTestFinished } from 'vitest'
import {
  clearTrackedMeetings,
  settleMeeting,
  trackMeeting,
  useMeetingTrackerStore,
} from '@/entities/meeting'
import { advanceSessionGeneration } from '@/entities/user'
import {
  PROCESSING_DONE_TITLE,
  PROCESSING_FAILED_TITLE,
  SPEAKERS_NEEDED_TITLE,
} from '@/features/meeting-processing'
import { paths } from '@/shared/config/routes'
import { workspaceKey } from '@/shared/api/queryKeys'
import { db, replaceDb } from '@/shared/mock/db'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import {
  advanceMeeting,
  completeMeeting,
  failMeeting,
  setMeetingFlowMode,
  startChatMeeting,
} from '@/shared/mock/meetingFlow'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { awaitSpeakers } from '@/shared/mock/speakerFlow'
import { AWAITING_MEETING_ID, createSpeakerScenarioDb } from '@/shared/mock/speakerScenarios'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { processingSignals, signalsWith } from './test/processingToast'
import { renderApp } from './test/renderApp'

/*
 * #424 — 오른쪽 아래 정리 진행 토스트. 실제 경로·추적기·MSW 를 그대로 탄다.
 * 픽스처 ws_01 의 mt_10(기획 논의 녹음)이 정리 중이다. 화자 지정은 speakerScenarios 의 업로드 회의(mt_11)로 본다.
 */

const UPLOAD = { workspaceId: 'ws_01', meetingId: AWAITING_MEETING_ID }

afterEach(() => {
  vi.useRealTimers()
  clearTrackedMeetings()
  localStorage.clear()
})

function fakeIntervals() {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
}

async function poll(ms = 3_000) {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}

/** 정리 중 진행 토스트(펼침) */
const processingCard = () => screen.queryByRole('region', { name: /정리 중$/ })
const pill = () => screen.queryByRole('button', { name: /펼치기/ })
/** 진행 토스트 안의 화면 읽기 알림 */
const announcement = () =>
  document.querySelector<HTMLElement>('[data-testid="pinned-toast-slot"] [role="status"]')

async function openTasks() {
  const app = renderApp(paths.tasks('ws_01'))
  await screen.findByRole('heading', { name: '태스크' })
  return app
}

async function waitForCard() {
  return waitFor(() => {
    const card = processingCard()
    expect(card).not.toBeNull()
    return card!
  })
}

async function waitForPill() {
  return waitFor(() => {
    const button = pill()
    expect(button).not.toBeNull()
    return button!
  })
}

/** 정리 중은 알약으로 시작한다. 눌러 펼친 카드를 돌려준다 */
async function openCard() {
  fireEvent.click(await waitForPill())
  return waitForCard()
}

/** 업로드 회의(mt_11)를 정리 중으로 둔다. 화자 지정 대기·지정 뒤 재개를 테스트가 직접 바꾼다 */
function processingUpload() {
  replaceDb(createSpeakerScenarioDb('meeting-speakers'))
  setMeetingFlowMode('manual')
  setStatus('processing')
  meetingRow().progress = { audio_merged: false, transcribed: false, extracted: false }
}

function meetingRow() {
  return db.meetings.find(({ meeting_id }) => meeting_id === AWAITING_MEETING_ID)!
}

function setStatus(status: 'processing' | 'awaiting_speakers' | 'failed') {
  meetingRow().status = status
  db.meetingSummaries.find(({ meeting_id }) => meeting_id === AWAITING_MEETING_ID)!.status = status
}

describe('진행 알림 닫기 (#614)', () => {
  it.each(['pm', 'member'] as const)(
    '%s은 대기 알림을 닫아도 화면 이동·정리 재개 뒤 숨김을 유지하고 완료와 캐시 갱신을 받는다',
    async (role) => {
      fakeIntervals()
      replaceDb(
        createSpeakerScenarioDb(role === 'pm' ? 'meeting-speakers' : 'meeting-speakers-member'),
      )
      setMeetingFlowMode('manual')
      const log = recordRequests()
      const app = await openTasks()
      await waitFor(() => expect(useMeetingTrackerStore.getState().meetings).toEqual([UPLOAD]))
      const current =
        role === 'pm'
          ? await screen.findByRole('region', { name: SPEAKERS_NEEDED_TITLE })
          : await screen.findByRole('group', { name: '주간 회고 녹음 정리 알림' })
      fireEvent.click(within(current).getByRole('button', { name: '닫기' }))
      expect(processingSignals()).toEqual([])
      expect(useMeetingTrackerStore.getState().meetings).toEqual([UPLOAD])
      expect(useMeetingTrackerStore.getState().dismissed).toEqual(['ws_01/mt_11'])

      fireEvent.click(screen.getByRole('link', { name: '팀' }))
      await app.expectPath(paths.members('ws_01'))
      await screen.findByRole('heading', { level: 1, name: '팀' })
      const requestsBefore = log.started.filter(({ path }) => path === '/meetings/mt_11').length
      await poll(30_000)
      await waitFor(() =>
        expect(log.started.filter(({ path }) => path === '/meetings/mt_11').length).toBeGreaterThan(
          requestsBefore,
        ),
      )
      expect(processingSignals()).toEqual([])

      setStatus('processing')
      await poll(30_000)
      expect(processingSignals()).toEqual([])
      const keys = [
        workspaceKey('ws_01', 'minutes', 'mt_11'),
        workspaceKey('ws_01', 'tasks', 'list'),
      ]
      keys.forEach((key) => app.queryClient.setQueryData(key, { cached: true }))
      completeMeeting(AWAITING_MEETING_ID)
      await poll()
      await waitFor(() => expect(signalsWith(PROCESSING_DONE_TITLE)).toHaveLength(1))
      await waitFor(() => expect(useMeetingTrackerStore.getState().meetings).toEqual([]))
      for (const key of keys) expect(app.queryClient.getQueryState(key)?.isInvalidated).toBe(true)
      expect(signalsWith(PROCESSING_DONE_TITLE)[0]).toHaveTextContent('주간 회고 녹음')
      fireEvent.click(
        within(signalsWith(PROCESSING_DONE_TITLE)[0]).getByRole('button', { name: '닫기' }),
      )
      expect(processingSignals()).toEqual([])
    },
    15_000,
  )

  it('PM은 숨긴 화자 지정 대기가 실패해도 실패 결과를 받는다', async () => {
    fakeIntervals()
    replaceDb(createSpeakerScenarioDb('meeting-speakers'))
    setMeetingFlowMode('manual')
    await openTasks()
    const card = await screen.findByRole('region', { name: SPEAKERS_NEEDED_TITLE })
    fireEvent.click(within(card).getByRole('button', { name: '닫기' }))
    setStatus('failed')
    meetingRow().failed_stage = 'speaker_assignment_expired'
    await poll(30_000)
    await waitFor(() => expect(signalsWith(PROCESSING_FAILED_TITLE)).toHaveLength(1))
    expect(signalsWith(PROCESSING_FAILED_TITLE)[0]).toHaveTextContent('화자 지정 대기가 7일을 넘어')
    expect(useMeetingTrackerStore.getState().meetings).toEqual([])
  })

  it('팀원의 숨긴 대기가 실패하면 기존 역할 정책대로 결과를 보이지 않는다', async () => {
    fakeIntervals()
    replaceDb(createSpeakerScenarioDb('meeting-speakers-member'))
    setMeetingFlowMode('manual')
    await openTasks()
    const pillGroup = await screen.findByRole('group', { name: '주간 회고 녹음 정리 알림' })
    fireEvent.click(within(pillGroup).getByRole('button', { name: '닫기' }))
    setStatus('failed')
    meetingRow().failed_stage = 'speaker_assignment_expired'
    await poll(30_000)
    await waitFor(() => expect(useMeetingTrackerStore.getState().meetings).toEqual([]))
    expect(processingSignals()).toEqual([])
  })

  it.each(['processing', 'speakers', 'done'] as const)(
    '세션이 바뀐 뒤 남은 %s 닫기 콜백은 새 세션의 추적과 결과를 바꾸지 않는다',
    async (kind) => {
      fakeIntervals()
      replaceDb(createSpeakerScenarioDb('meeting-speakers'))
      setMeetingFlowMode('manual')
      if (kind === 'processing') setStatus('processing')
      await openTasks()
      await waitFor(() => expect(useMeetingTrackerStore.getState().meetings).toEqual([UPLOAD]))
      if (kind === 'done') {
        setStatus('processing')
        completeMeeting(AWAITING_MEETING_ID)
        await poll(30_000)
        await waitFor(() => expect(signalsWith(PROCESSING_DONE_TITLE)).toHaveLength(1))
      }
      const close = screen.getByRole('button', { name: '닫기' })
      act(() => {
        advanceSessionGeneration()
        clearTrackedMeetings()
        if (kind === 'done') settleMeeting({ ...UPLOAD, title: '새 세션 결과', outcome: 'done' })
        else trackMeeting(UPLOAD)
      })
      const nextSessionState = useMeetingTrackerStore.getState()
      fireEvent.click(close)
      expect(useMeetingTrackerStore.getState()).toBe(nextSessionState)
      expect(useMeetingTrackerStore.getState().dismissed).toEqual([])
      if (kind === 'done')
        expect(useMeetingTrackerStore.getState().settled[0]?.title).toBe('새 세션 결과')
    },
  )
})

describe('상태 전환 — 같은 회의의 토스트 하나가 바뀐다', () => {
  it('PM: 정리 중 → 화자 지정 필요 → 정리 중 → 완료', async () => {
    fakeIntervals()
    processingUpload()
    const app = renderApp(paths.members('ws_01'))
    expect(await screen.findByRole('heading', { level: 1, name: '팀' })).toHaveTextContent(/^팀$/)
    act(() => trackMeeting(UPLOAD))

    const processing = await openCard()
    expect(processing).toHaveTextContent('주간 회고 녹음 정리 중')
    expect(processing).toHaveTextContent('차례를 기다리고 있어요')
    expect(processing).toHaveTextContent('0 / 3 단계 완료')
    expect(within(processing).getByRole('button', { name: '닫기' })).toBeVisible()
    const status = announcement()

    awaitSpeakers(AWAITING_MEETING_ID)
    await poll()
    const speakers = await waitFor(() => {
      expect(signalsWith(SPEAKERS_NEEDED_TITLE)).toHaveLength(1)
      return signalsWith(SPEAKERS_NEEDED_TITLE)[0]
    })
    expect(speakers).toHaveTextContent('주간 회고 녹음 · 누가 말했는지 정하면 정리가 이어져요')
    expect(speakers).toHaveTextContent('7일 안에 정해 주세요')
    expect(within(speakers).getByRole('button', { name: '닫기' })).toBeVisible()
    expect(within(speakers).getByRole('button', { name: '접기' })).toBeVisible()
    expect(processingSignals()).toHaveLength(1)

    // 다른 곳에서 화자를 지정해 정리가 이어진다
    setStatus('processing')
    meetingRow().progress = { audio_merged: true, transcribed: true, extracted: false }
    await poll(30_000)
    await waitFor(() =>
      expect(processingCard()).toHaveTextContent('결정사항과 할 일을 뽑고 있어요'),
    )
    expect(processingSignals()).toHaveLength(1)

    completeMeeting(AWAITING_MEETING_ID)
    await poll()
    const done = await waitFor(() => {
      expect(signalsWith(PROCESSING_DONE_TITLE)).toHaveLength(1)
      return signalsWith(PROCESSING_DONE_TITLE)[0]
    })
    expect(done).toHaveTextContent('주간 회고 녹음')
    expect(processingSignals()).toHaveLength(1)
    // 화면 읽기 알림은 같은 요소가 남아 바뀐 단계를 읽는다
    expect(announcement()).toBe(status)
    expect(status).toHaveTextContent('회의 정리가 끝났어요')
    // 다른 화면의 PM 은 옮기지 않는다
    await app.expectPath(paths.members('ws_01'))
  }, 15_000)

  it('PM: 실패하면 실패 안내로 바뀌고 닫을 수 있다 — 저절로 사라지지 않는다', async () => {
    fakeIntervals()
    const user = userEvent.setup()
    await openTasks()
    await openCard()

    failMeeting('mt_10', { failedStage: 'diarize' })
    await poll()
    const failed = await waitFor(() => {
      expect(signalsWith(PROCESSING_FAILED_TITLE)).toHaveLength(1)
      return signalsWith(PROCESSING_FAILED_TITLE)[0]
    })
    expect(failed).toHaveTextContent(
      '기획 논의 녹음 · 음성 처리 중 회의 정리를 완료하지 못했어요. 파일을 다시 올려 주세요.',
    )
    await poll(60_000)
    expect(signalsWith(PROCESSING_FAILED_TITLE)).toHaveLength(1)

    await user.click(within(failed).getByRole('button', { name: '닫기' }))
    expect(processingSignals()).toEqual([])
  })
})

describe('역할별 노출', () => {
  it('팀원: 화자 지정 대기는 정리 중 모양으로 「화자 지정을 기다리고 있어요」다 — 화자 지정 토스트는 없다', async () => {
    replaceDb(createSpeakerScenarioDb('meeting-speakers-member'))
    setMeetingFlowMode('manual')
    renderApp(paths.members('ws_01'))
    expect(await screen.findByRole('heading', { level: 1, name: '팀' })).toHaveTextContent(/^팀$/)
    act(() => trackMeeting(UPLOAD))

    const card = await openCard()
    expect(card).toHaveTextContent('화자 지정을 기다리고 있어요')
    expect(card).toHaveTextContent('1 / 3 단계 완료')
    expect(signalsWith(SPEAKERS_NEEDED_TITLE)).toEqual([])
    expect(screen.queryByRole('button', { name: '화자 지정하기' })).toBeNull()
  })

  it('PM: 새로 연 앱도 공간 목록에서 화자 지정 대기 회의를 찾아 펼친 화자 지정 카드를 보인다', async () => {
    replaceDb(createSpeakerScenarioDb('meeting-speakers'))
    setMeetingFlowMode('manual')
    await openTasks()

    await waitFor(() => expect(signalsWith(SPEAKERS_NEEDED_TITLE)).toHaveLength(1))
    expect(signalsWith(SPEAKERS_NEEDED_TITLE)[0].tagName).toBe('SECTION')
    expect(processingSignals()).toHaveLength(1)
  })

  it('PM: 「화자 지정하기」는 그 회의의 화자 지정 화면으로 간다', async () => {
    const user = userEvent.setup()
    replaceDb(createSpeakerScenarioDb('meeting-speakers'))
    const app = renderApp(paths.members('ws_01'))
    expect(await screen.findByRole('heading', { level: 1, name: '팀' })).toHaveTextContent(/^팀$/)
    act(() => trackMeeting(UPLOAD))
    const speakers = await waitFor(() => {
      expect(signalsWith(SPEAKERS_NEEDED_TITLE)).toHaveLength(1)
      return signalsWith(SPEAKERS_NEEDED_TITLE)[0]
    })

    await user.click(within(speakers).getByRole('button', { name: '화자 지정하기' }))
    await app.expectPath(paths.meetingSpeakers('ws_01', AWAITING_MEETING_ID))
    expect(
      await screen.findByRole('heading', { name: '누가 말했는지 골라 주세요', level: 1 }),
    ).toBeInTheDocument()
  })

  it('팀원: 새로 연 앱도 화자 지정 대기 회의를 찾아 정리 중 알약을 보이고, 펼치면 기다린다는 문장이다', async () => {
    replaceDb(createSpeakerScenarioDb('meeting-speakers-member'))
    setMeetingFlowMode('manual')
    await openTasks()

    expect(await openCard()).toHaveTextContent('화자 지정을 기다리고 있어요')
    expect(processingSignals()).toHaveLength(1)
  })

  it('팀원: 실패하면 토스트가 조용히 사라진다', async () => {
    fakeIntervals()
    setMockRole('member')
    await openTasks()
    await openCard()

    failMeeting('mt_10')
    await poll()
    await waitFor(() => expect(useMeetingTrackerStore.getState().meetings).toEqual([]))
    await waitFor(() => expect(processingSignals()).toEqual([]))
    expect(document.querySelectorAll('[data-toast-key]')).toHaveLength(0)
  })

  it('팀원: 완료는 본다 — 회의록 보기로 그 회의록에 간다', async () => {
    fakeIntervals()
    setMockRole('member')
    const app = await openTasks()
    await openCard()

    completeMeeting('mt_10')
    await poll()
    const done = await waitFor(() => {
      expect(signalsWith(PROCESSING_DONE_TITLE)).toHaveLength(1)
      return signalsWith(PROCESSING_DONE_TITLE)[0]
    })
    fireEvent.click(within(done).getByRole('button', { name: '회의록 보기' }))
    await app.expectPath(paths.meetings('ws_01', 'mt_10'))
  })
})

describe('같은 공간의 이어진 정리', () => {
  it('완료를 닫지 않고 다음 회의를 정리하면 결과 하나와 정리 중 하나이고, 다음 결과가 이전 결과를 바꾼다', async () => {
    fakeIntervals()
    processingUpload()
    renderApp(paths.members('ws_01'))
    expect(await screen.findByRole('heading', { level: 1, name: '팀' })).toHaveTextContent(/^팀$/)
    act(() => trackMeeting(UPLOAD))
    await openCard()

    completeMeeting(AWAITING_MEETING_ID)
    await poll()
    await waitFor(() => expect(signalsWith(PROCESSING_DONE_TITLE)).toHaveLength(1))

    const next = { ...structuredClone(meetingRow()), meeting_id: 'mt_12', title: '두 번째 회의' }
    db.meetings.push({
      ...next,
      status: 'processing',
      extraction_id: null,
      progress: { audio_merged: false, transcribed: false, extracted: false },
    })
    // 서버 목록에도 정리 중으로 있다 — 토스트는 출처를 목록에서 읽고, 받아 둔 목록에 없으면 한 번 새로 받는다 (#483)
    db.meetingSummaries.push({
      ...structuredClone(
        db.meetingSummaries.find(({ meeting_id }) => meeting_id === AWAITING_MEETING_ID)!,
      ),
      meeting_id: 'mt_12',
      title: '두 번째 회의',
      status: 'processing',
    })
    db.meetingFlow.attendees.mt_12 = db.meetingFlow.attendees[AWAITING_MEETING_ID]
    act(() => trackMeeting({ workspaceId: 'ws_01', meetingId: 'mt_12' }))
    await waitFor(() => expect(processingSignals()).toHaveLength(2))
    await waitFor(() => expect(pill()).toHaveTextContent('정리 중0/3'))

    completeMeeting('mt_12')
    await poll()
    await waitFor(() => expect(pill()).toBeNull())
    expect(processingSignals()).toHaveLength(1)
    expect(signalsWith(PROCESSING_DONE_TITLE)[0]).toHaveTextContent('두 번째 회의')
    expect(useMeetingTrackerStore.getState().settled).toHaveLength(1)
  }, 15_000)
})

describe('보이는 자리', () => {
  it('그 회의의 처리 화면에서는 숨기고, 다른 화면으로 가면 다시 보인다', async () => {
    const user = userEvent.setup()
    renderApp(paths.meetingProcessing('ws_01', 'mt_10'))
    await screen.findByRole('heading', { name: '정리하고 있어요' })
    await waitFor(() => expect(useMeetingTrackerStore.getState().meetings).toHaveLength(1))
    expect(processingSignals()).toEqual([])

    await user.click(screen.getByRole('link', { name: '태스크' }))
    await screen.findByRole('heading', { name: '태스크' })
    await openCard()
  })

  it('그 회의의 화자 지정 화면에서는 숨긴다', async () => {
    replaceDb(createSpeakerScenarioDb('meeting-speakers'))
    renderApp(paths.meetingSpeakers('ws_01', AWAITING_MEETING_ID))
    await screen.findByRole('heading', { name: '누가 말했는지 골라 주세요', level: 1 })
    act(() => trackMeeting(UPLOAD))
    await waitFor(() =>
      expect(useMeetingTrackerStore.getState().prompted).toContain(`ws_01/${AWAITING_MEETING_ID}`),
    )
    expect(processingSignals()).toEqual([])
  })

  it('공간을 바꾸면 이전 공간의 토스트가 남지 않고, 돌아오면 다시 보인다 (D-088)', async () => {
    db.workspaces.push({
      workspace_id: 'ws_04',
      name: '알고리즘 스터디',
      role: 'pm',
      created_at: '2026-09-04T00:00:00Z',
      onboarding: {
        completed: true,
        current_step: null,
        steps: (['create_workspace', 'connect_discord', 'connect_notion', 'connect_members'] as const).map((step) => ({ step, status: 'completed' as const })),
      },
    })
    db.accounts[0].workspaceIds.push('ws_04')
    db.integrations.ws_04 = {
      discord: {
        status: 'connected',
        display_name: 'x',
        connected_at: MOCK_NOW,
        chat_channel: null,
      },
      notion: { status: 'connected', display_name: 'x', connected_at: MOCK_NOW },
    }
    const app = await openTasks()
    await openCard()

    act(() => app.navigate(paths.dashboard('ws_04')))
    await app.expectPath(paths.dashboard('ws_04'))
    await screen.findByRole('heading', { name: '대시보드' })
    expect(processingSignals()).toEqual([])
    expect(useMeetingTrackerStore.getState().meetings).toEqual([
      { workspaceId: 'ws_01', meetingId: 'mt_10' },
    ])

    act(() => app.navigate(paths.tasks('ws_01')))
    await screen.findByRole('heading', { name: '태스크' })
    await openCard()
  })
})

describe('세션 경계', () => {
  it.each([
    ['자세히 보기', 'processing'],
    ['회의록 보기', 'done'],
  ] as const)('세션이 바뀐 뒤 누른 「%s」는 옮기지 않는다', async (action, state) => {
    fakeIntervals()
    const app = await openTasks()
    await openCard()
    if (state === 'done') {
      completeMeeting('mt_10')
      await poll()
      await waitFor(() => expect(signalsWith(PROCESSING_DONE_TITLE)).toHaveLength(1))
    }

    act(() => advanceSessionGeneration())
    fireEvent.click(screen.getByRole('button', { name: action }))
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(app.visited().map(({ pathname }) => pathname)).toEqual([paths.tasks('ws_01')])
  })

  it('세션이 바뀐 뒤 누른 「화자 지정하기」는 옮기지 않는다', async () => {
    replaceDb(createSpeakerScenarioDb('meeting-speakers'))
    const app = renderApp(paths.members('ws_01'))
    expect(await screen.findByRole('heading', { level: 1, name: '팀' })).toHaveTextContent(/^팀$/)
    act(() => trackMeeting(UPLOAD))
    await waitFor(() => expect(signalsWith(SPEAKERS_NEEDED_TITLE)).toHaveLength(1))

    act(() => advanceSessionGeneration())
    fireEvent.click(screen.getByRole('button', { name: '화자 지정하기' }))
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(app.visited().map(({ pathname }) => pathname)).toEqual([paths.members('ws_01')])
  })
})

describe('접기', () => {
  it('화면 폭과 상관없이 정리 중은 「정리 중 n/3」 알약으로 시작하고, 펼치면 같은 공간의 다른 화면에서도 펼친 채다. 새로 열면 다시 알약이다', async () => {
    const user = userEvent.setup()
    const first = await openTasks()
    const button = await waitForPill()
    expect(processingCard()).toBeNull()
    expect(button).toHaveTextContent('정리 중1/3')
    expect(button).toHaveAttribute('aria-expanded', 'false')

    await user.click(button)
    const collapse = within(await waitForCard()).getByRole('button', { name: '접기' })
    expect(collapse).toHaveFocus()
    expect(collapse).toHaveAttribute('aria-expanded', 'true')

    await user.click(screen.getByRole('link', { name: '팀' }))
    await screen.findByRole('heading', { level: 1, name: '팀' })
    expect(processingCard()).not.toBeNull()

    await user.click(within(processingCard()!).getByRole('button', { name: '접기' }))
    expect(pill()).toHaveFocus()

    first.unmount()
    clearTrackedMeetings()
    await openTasks()
    await waitForPill()
    expect(processingCard()).toBeNull()
    expect(localStorage.length).toBe(0)
  })

  it('화자 지정 필요도 접어 알약으로 둔다. 상태가 바뀌면 다시 펼치고, 정리 중의 단계 진행은 접힘을 그대로 둔다', async () => {
    fakeIntervals()
    const user = userEvent.setup()
    processingUpload()
    renderApp(paths.members('ws_01'))
    expect(await screen.findByRole('heading', { level: 1, name: '팀' })).toHaveTextContent(/^팀$/)
    act(() => trackMeeting(UPLOAD))

    expect(await waitForPill()).toHaveTextContent('정리 중0/3')

    meetingRow().progress = { audio_merged: true, transcribed: false, extracted: false }
    await poll()
    await waitFor(() => expect(pill()).toHaveTextContent('정리 중1/3'))
    expect(processingCard()).toBeNull()

    awaitSpeakers(AWAITING_MEETING_ID)
    await poll()
    const speakers = await waitFor(() => {
      expect(signalsWith(SPEAKERS_NEEDED_TITLE)).toHaveLength(1)
      return signalsWith(SPEAKERS_NEEDED_TITLE)[0]
    })
    expect(speakers.tagName).toBe('SECTION')
    expect(pill()).toBeNull()

    await user.click(within(speakers).getByRole('button', { name: '접기' }))
    expect(pill()).toHaveTextContent(SPEAKERS_NEEDED_TITLE)
    expect(pill()).not.toHaveTextContent(/\d\/3/)
    expect(pill()).toHaveFocus()
    expect(screen.getByRole('button', { name: '닫기' })).toBeVisible()

    setStatus('processing')
    meetingRow().progress = { audio_merged: true, transcribed: true, extracted: false }
    await poll(30_000)
    await waitFor(() =>
      expect(processingCard()).toHaveTextContent('결정사항과 할 일을 뽑고 있어요'),
    )
    expect(pill()).toBeNull()
  }, 15_000)

  it('접은 화자 지정 필요 알약을 누르면 화자 지정 카드를 다시 펼친다', async () => {
    const user = userEvent.setup()
    replaceDb(createSpeakerScenarioDb('meeting-speakers'))
    renderApp(paths.members('ws_01'))
    expect(await screen.findByRole('heading', { level: 1, name: '팀' })).toHaveTextContent(/^팀$/)
    act(() => trackMeeting(UPLOAD))
    const speakers = await waitFor(() => {
      expect(signalsWith(SPEAKERS_NEEDED_TITLE)).toHaveLength(1)
      return signalsWith(SPEAKERS_NEEDED_TITLE)[0]
    })
    await user.click(within(speakers).getByRole('button', { name: '접기' }))
    const collapsed = pill()!
    expect(collapsed).toHaveTextContent(SPEAKERS_NEEDED_TITLE)

    await user.click(collapsed)
    expect(pill()).toBeNull()
    const expanded = signalsWith(SPEAKERS_NEEDED_TITLE)
    expect(expanded).toHaveLength(1)
    expect(expanded[0].tagName).toBe('SECTION')
    expect(within(expanded[0]).getByRole('button', { name: '화자 지정하기' })).toBeVisible()
  })

  it('알약으로 시작한 정리 중이 화자 지정 필요를 거쳐 정리 중으로 돌아오면 펼쳐 보인다', async () => {
    fakeIntervals()
    processingUpload()
    renderApp(paths.members('ws_01'))
    expect(await screen.findByRole('heading', { level: 1, name: '팀' })).toHaveTextContent(/^팀$/)
    act(() => trackMeeting(UPLOAD))
    await waitForPill()

    awaitSpeakers(AWAITING_MEETING_ID)
    await poll()
    await waitFor(() => expect(signalsWith(SPEAKERS_NEEDED_TITLE)).toHaveLength(1))
    expect(pill()).toBeNull()

    setStatus('processing')
    await poll(30_000)
    await waitForCard()
    expect(pill()).toBeNull()
  }, 15_000)
})

describe('단계 표시는 처리 화면과 같은 목록이다 (#483)', () => {
  it('녹음 회의는 넘기는 중(extracted 참, 아직 processing)에도 2/3 이고 마지막 칸이 진행 중이다', async () => {
    fakeIntervals()
    db.meetings.find(({ meeting_id }) => meeting_id === 'mt_10')!.progress = {
      audio_merged: true,
      transcribed: true,
      extracted: true,
    }
    await openTasks()
    expect(await waitForPill()).toHaveTextContent('정리 중2/3')
    const card = await openCard()
    expect(card).toHaveTextContent('결정사항과 할 일을 뽑고 있어요')
    expect(card).toHaveTextContent('2 / 3 단계 완료')
  })

  it('채팅 회의는 두 단계다 — 대화 모으기 0/2 → 뽑아내기 1/2, 넘기는 중에도 1/2 다', async () => {
    fakeIntervals()
    completeMeeting('mt_10')
    const chatId = startChatMeeting()
    const chat = db.meetings.find(({ meeting_id }) => meeting_id === chatId)!
    await openTasks()
    expect(await waitForPill()).toHaveTextContent('정리 중0/2')
    const card = await openCard()
    expect(card).toHaveTextContent('대화를 모으고 있어요')
    expect(card).toHaveTextContent('0 / 2 단계 완료')

    chat.progress = { audio_merged: true, transcribed: true, extracted: false }
    await poll()
    await waitFor(() => expect(processingCard()).toHaveTextContent('1 / 2 단계 완료'))
    expect(processingCard()).toHaveTextContent('결정사항과 할 일을 뽑고 있어요')

    chat.progress = { audio_merged: true, transcribed: true, extracted: true }
    await poll()
    await poll()
    expect(processingCard()).toHaveTextContent('1 / 2 단계 완료')
  })
})

describe('출처를 모를 때 — 토스트도 단계 수를 짐작하지 않는다 (#483 리뷰)', () => {
  it('처리 화면이 목록을 기다리는 사이 떠나면 알약은 단계 수 없이 「정리 중」이고, 목록이 오면 채팅 0/2 다', async () => {
    completeMeeting('mt_10')
    const chatId = startChatMeeting()
    const list = deferred()
    server.use(
      http.get('/api/v1/workspaces/ws_01/meetings', async () => {
        await list.promise
        return undefined
      }),
    )
    const app = renderApp(paths.meetingProcessing('ws_01', chatId))
    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '정리 단계' })).toBeNull()

    act(() => app.navigate(paths.tasks('ws_01')))
    const button = await waitForPill()
    expect(button).toHaveTextContent(/^정리 중/)
    expect(button).not.toHaveTextContent(/\d\//)
    fireEvent.click(button)
    const card = await waitForCard()
    expect(card).toHaveTextContent('회의를 정리하고 있어요')
    expect(card).not.toHaveTextContent('단계 완료')

    list.resolve()
    await waitFor(() => expect(processingCard()).toHaveTextContent('0 / 2 단계 완료'))
    expect(processingCard()).toHaveTextContent('대화를 모으고 있어요')
  })
})

describe('화면 읽기 알림 (role=status)', () => {
  it('단계가 바뀔 때만 문장이 바뀐다 — 같은 단계의 polling·접기는 알림을 건드리지 않는다', async () => {
    fakeIntervals()
    const user = userEvent.setup()
    await openTasks()
    await openCard()
    const status = announcement()!
    expect(status).toHaveTextContent('음성을 텍스트로 옮기고 있어요')
    expect(status).not.toHaveTextContent(/단계 완료|\d\/3/)

    const changes: MutationRecord[] = []
    const observer = new MutationObserver((records) => changes.push(...records))
    observer.observe(status, { childList: true, characterData: true, subtree: true })
    onTestFinished(() => observer.disconnect())

    await poll()
    await poll()
    await user.click(screen.getByRole('button', { name: '접기' }))
    await user.click(pill()!)
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(changes).toEqual([])
    expect(announcement()).toBe(status)

    advanceMeeting('mt_10')
    await poll()
    await waitFor(() => expect(status).toHaveTextContent('결정사항과 할 일을 뽑고 있어요'))
    expect(changes.length).toBeGreaterThan(0)
  })
})
