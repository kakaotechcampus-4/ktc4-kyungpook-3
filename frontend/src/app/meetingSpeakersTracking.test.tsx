import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  clearTrackedMeetings,
  promptSpeakers,
  trackMeeting,
  useMeetingTrackerStore,
} from '@/entities/meeting'
import { SPEAKERS_NEEDED_ACTION, SPEAKERS_NEEDED_TITLE } from '@/features/meeting-processing'
import { paths } from '@/shared/config/routes'
import { db, replaceDb } from '@/shared/mock/db'
import { setMeetingFlowMode } from '@/shared/mock/meetingFlow'
import { setMockRole } from '@/shared/mock/sessions'
import { awaitSpeakers } from '@/shared/mock/speakerFlow'
import { AWAITING_MEETING_ID, createSpeakerScenarioDb } from '@/shared/mock/speakerScenarios'
import { recordRequests } from '@/shared/test/requests'
import { toast } from '@/shared/ui/toast'
import { renderApp } from './test/renderApp'

/*
 * #256 처리 추적이 화자 지정 대기를 놓치지 않는다. 대기는 접근 상실(lost)이 아니라 진행이다 —
 * 그 회의의 처리 화면을 보던 PM 은 지정 화면으로 옮기고, 다른 화면의 PM 은 토스트로 안내받는다. 팀원에게는 안내하지 않는다.
 * 흐름 방식을 manual 로 두고 서버 상태는 speakerFlow 로 바꾼다. 간격은 setInterval 만 가짜로 돌린다.
 */

const MEETING = { workspaceId: 'ws_01', meetingId: AWAITING_MEETING_ID }
const PROCESSING_PATH = paths.meetingProcessing('ws_01', AWAITING_MEETING_ID)
const SPEAKERS_PATH = paths.meetingSpeakers('ws_01', AWAITING_MEETING_ID)

afterEach(() => {
  vi.useRealTimers()
  clearTrackedMeetings()
  toast.clear()
})

const speakerToasts = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-toast-key]')).filter((node) =>
    node.textContent?.includes(SPEAKERS_NEEDED_TITLE),
  )

/** mt_11 이 아직 정리 중이다. 다음 상세 조회 전에 awaitSpeakers 로 대기로 바꾼다 */
function processingUpload() {
  replaceDb(createSpeakerScenarioDb('meeting-speakers'))
  setMeetingFlowMode('manual')
  const meeting = db.meetings.find(({ meeting_id }) => meeting_id === AWAITING_MEETING_ID)!
  meeting.status = 'processing'
  meeting.progress = { audio_merged: false, transcribed: false, extracted: false }
}

function awaitingUpload() {
  replaceDb(createSpeakerScenarioDb('meeting-speakers'))
  setMeetingFlowMode('manual')
}

const detailRequests = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ path }) => path === `/meetings/${AWAITING_MEETING_ID}`)

describe('처리 추적 — 화자 지정 대기', () => {
  it('처리 화면을 보던 PM 은 대기가 되는 순간 지정 화면으로 바꿔 간다', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    processingUpload()
    const app = renderApp(PROCESSING_PATH)
    await screen.findByRole('heading', { name: '정리하고 있어요' })
    await waitFor(() => expect(useMeetingTrackerStore.getState().meetings).toContainEqual(MEETING))
    awaitSpeakers(AWAITING_MEETING_ID)
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    await app.expectPath(SPEAKERS_PATH)
    expect(app.visitedActions().at(-1)).toBe('REPLACE')
    expect(speakerToasts()).toEqual([])
    // 추적은 이어진다 — 지정 뒤 완료·실패를 기존 처리가 받는다
    expect(useMeetingTrackerStore.getState().meetings).toContainEqual(MEETING)
  })

  it('다른 화면의 PM 은 토스트를 한 번만 받고, 그 동작으로 지정 화면에 간다', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    awaitingUpload()
    const log = recordRequests()
    const app = renderApp(paths.members('ws_01'))
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(/^팀$/)
    act(() => trackMeeting(MEETING))
    await waitFor(() => expect(speakerToasts()).toHaveLength(1))
    // 대기 중에도 polling 을 멈추지 않는다. 3초가 아니라 30초 간격이고, 다시 안내하지 않는다
    const before = detailRequests(log).length
    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(detailRequests(log)).toHaveLength(before)
    await act(() => vi.advanceTimersByTimeAsync(27_000))
    await waitFor(() => expect(detailRequests(log).length).toBeGreaterThan(before))
    expect(speakerToasts()).toHaveLength(1)
    fireEvent.click(
      within(speakerToasts()[0]).getByRole('button', { name: SPEAKERS_NEEDED_ACTION }),
    )
    await app.expectPath(SPEAKERS_PATH)
  })

  it('PM 이 처리 화면에 직접 들어와도 처음 본 대기면 지정 화면으로 간다', async () => {
    awaitingUpload()
    const app = renderApp(PROCESSING_PATH)
    await app.expectPath(SPEAKERS_PATH)
  })

  it('이미 안내한 대기 회의의 처리 화면에서는 대기 안내와 지정 화면 링크를 본다', async () => {
    awaitingUpload()
    promptSpeakers(MEETING)
    const app = renderApp(PROCESSING_PATH)
    expect(await screen.findByRole('heading', { name: '화자 지정이 필요해요' })).toBeVisible()
    expect(screen.getByRole('link', { name: '화자 지정하기' })).toHaveAttribute(
      'href',
      SPEAKERS_PATH,
    )
    await app.expectPath(PROCESSING_PATH)
  })

  it('팀원은 처리 화면에 PM 이 지정 중이라는 안내만 보고 옮겨지거나 토스트를 받지 않는다', async () => {
    awaitingUpload()
    setMockRole('member')
    const app = renderApp(PROCESSING_PATH)
    expect(await screen.findByText(/PM이 화자를 지정하고 있어요/)).toBeVisible()
    expect(screen.queryByRole('link', { name: '화자 지정하기' })).not.toBeInTheDocument()
    await waitFor(() => expect(useMeetingTrackerStore.getState().prompted).toHaveLength(1))
    await app.expectPath(PROCESSING_PATH)
    expect(speakerToasts()).toEqual([])
  })
})
