import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import type { MockInstance } from 'vitest'
import { clearTrackedMeetings, trackMeeting, useMeetingTrackerStore } from '@/entities/meeting'
import { SPEAKERS_NEEDED_ACTION } from '@/features/meeting-processing'
import { paths } from '@/shared/config/routes'
import { db, replaceDb } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { setMeetingFlowMode } from '@/shared/mock/meetingFlow'
import { server } from '@/shared/mock/server'
import {
  addAwaitingUpload,
  AWAITING_MEETING_ID,
  createSpeakerScenarioDb,
} from '@/shared/mock/speakerScenarios'
import type { SpeakerScenario } from '@/shared/mock/speakerScenarios'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { toast } from '@/shared/ui/toast'
import { renderApp } from './test/renderApp'

/* jsdom 은 미디어를 재생하지 않는다 — play·pause 만 바꾸고 위치(currentTime)는 테스트가 옮긴다 */

const SPEAKERS_PATH = paths.meetingSpeakers('ws_01', AWAITING_MEETING_ID)
const PROCESSING_PATH = paths.meetingProcessing('ws_01', AWAITING_MEETING_ID)

let play: MockInstance<HTMLMediaElement['play']>
let pause: MockInstance<HTMLMediaElement['pause']>
beforeEach(() => {
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  clearTrackedMeetings()
  toast.clear()
})

async function openSpeakers(scenario: SpeakerScenario = 'meeting-speakers') {
  replaceDb(createSpeakerScenarioDb(scenario))
  const app = renderApp(SPEAKERS_PATH)
  await screen.findByRole('heading', { name: '누가 말했는지 골라 주세요', level: 1 })
  await screen.findByRole('heading', { name: '화자 1' })
  return app
}

const card = (title: string) => screen.getByRole('region', { name: title })
const group = (title: string) => within(card(title)).getByRole('group', { name: `${title} 지정` })
const submitButton = () => screen.getByRole('button', { name: /지정하고 정리 이어 가기/ })

async function chooseAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(group('화자 1')).getByRole('radio', { name: /김서연/ }))
  await user.click(within(group('화자 2')).getByRole('radio', { name: /김서연/ }))
  await user.click(within(group('화자 3')).getByRole('radio', { name: /외부 참석자/ }))
}

describe('화자 지정 화면 — PM', () => {
  it('라벨을 응답 순서로 화자 1·2·3 으로 보이고 총 발화 시간을 함께 보인다', async () => {
    await openSpeakers()
    expect(screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)).toEqual([
      '화자 1',
      '화자 2',
      '화자 3',
    ])
    expect(within(card('화자 1')).getByText('총 12분 34초 말함')).toBeInTheDocument()
    expect(within(card('화자 3')).getByText('총 4초 말함')).toBeInTheDocument()
    expect(screen.queryByText(/SPEAKER_/)).not.toBeInTheDocument()
  })

  it('모든 화자를 고르기 전에는 낼 수 없고 남은 수를 보인다', async () => {
    const user = userEvent.setup()
    await openSpeakers()
    expect(submitButton()).toBeDisabled()
    expect(screen.getByText('아직 고르지 않은 화자 3명')).toBeInTheDocument()
    await user.click(within(group('화자 1')).getByRole('radio', { name: /김서연/ }))
    await user.click(within(group('화자 3')).getByRole('radio', { name: /외부 참석자/ }))
    expect(screen.getByText('아직 고르지 않은 화자 1명')).toBeInTheDocument()
    expect(submitButton()).toBeDisabled()
    await user.click(within(group('화자 2')).getByRole('radio', { name: /박민수/ }))
    expect(screen.queryByText(/아직 고르지 않은 화자/)).not.toBeInTheDocument()
    expect(submitButton()).toBeEnabled()
  })

  it('같은 팀원을 다른 화자에 고르면 막지 않고 이미 지정된 곳을 알린다', async () => {
    const user = userEvent.setup()
    await openSpeakers()
    await user.click(within(group('화자 1')).getByRole('radio', { name: /김서연/ }))
    expect(
      within(group('화자 2')).getByRole('radio', { name: /김서연\s*이미 화자 1에 지정됨/ }),
    ).toBeEnabled()
  })

  it('다른 팀원 묶음을 펼쳐 참석자 밖의 팀원을 키보드로 고를 수 있다', async () => {
    const user = userEvent.setup()
    await openSpeakers()
    const toggle = await within(group('화자 1')).findByRole('button', {
      name: '다른 팀원 1명 보기',
    })
    expect(within(group('화자 1')).queryByRole('radio', { name: /정하늘/ })).not.toBeInTheDocument()
    toggle.focus()
    await user.keyboard('{Enter}')
    const other = within(group('화자 1')).getByRole('radio', { name: /정하늘/ })
    other.focus()
    await user.keyboard(' ')
    expect(other).toBeChecked()
  })

  it('모두 골라 내면 계약 모양의 지정이 서버에 가고 처리 화면으로 바꿔 간다', async () => {
    const user = userEvent.setup()
    const log = recordRequests()
    const app = await openSpeakers()
    await chooseAll(user)
    await user.click(submitButton())
    await app.expectPath(PROCESSING_PATH)
    expect(app.visitedActions().at(-1)).toBe('REPLACE')
    expect(db.meetingFlow.speakers[AWAITING_MEETING_ID].mapping).toEqual({
      SPEAKER_00: 'mb_01',
      SPEAKER_01: 'mb_01',
      SPEAKER_02: null,
    })
    expect(
      log.started.filter(({ method, path }) => method === 'PUT' && path.endsWith('/speakers')),
    ).toHaveLength(1)
    expect(useMeetingTrackerStore.getState().meetings).toContainEqual({
      workspaceId: 'ws_01',
      meetingId: AWAITING_MEETING_ID,
    })
    expect(await screen.findByRole('heading', { name: '정리하고 있어요' })).toBeInTheDocument()
  })

  it('기한이 지나 409 failed 면 실제 사유를 다시 받아 안내하고 다시 낼 수 없다', async () => {
    const user = userEvent.setup()
    await openSpeakers('meeting-speakers-expired')
    await chooseAll(user)
    await user.click(submitButton())
    expect(
      await screen.findByRole('heading', { name: '화자 지정 기한이 지났어요' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '다시 업로드' })).toHaveAttribute(
      'href',
      paths.meetingUpload('ws_01'),
    )
    expect(
      screen.queryByRole('button', { name: /지정하고 정리 이어 가기/ }),
    ).not.toBeInTheDocument()
  })

  it('만료된 회의 다음에 연 다른 대기 회의는 만료가 아니라 지정 폼을 보인다', async () => {
    const user = userEvent.setup()
    const app = await openSpeakers('meeting-speakers-expired')
    addAwaitingUpload(db, {}, 'mt_12')
    await chooseAll(user)
    await user.click(submitButton())
    await screen.findByRole('heading', { name: '화자 지정 기한이 지났어요' })

    act(() => trackMeeting({ workspaceId: 'ws_01', meetingId: 'mt_12' }))
    fireEvent.click(await screen.findByRole('button', { name: SPEAKERS_NEEDED_ACTION }))
    await app.expectPath(paths.meetingSpeakers('ws_01', 'mt_12'))
    expect(await screen.findByRole('heading', { name: '화자 1' })).toBeInTheDocument()
    expect(submitButton()).toBeDisabled()
    expect(screen.getByText('아직 고르지 않은 화자 3명')).toBeInTheDocument()
    expect(screen.queryByText('화자 지정 기한이 지났어요')).not.toBeInTheDocument()
  })

  it('내는 중 다른 화면으로 가면 늦은 성공에도 그 화면에 남고 정리는 추적한다', async () => {
    const user = userEvent.setup()
    const app = await openSpeakers()
    setMeetingFlowMode('manual')
    const response = deferred()
    server.use(
      // 응답 없이 끝나면 기본 handler 가 지정을 받아 200 을 준다
      http.put('/api/v1/meetings/:meetingId/speakers', async () => {
        await response.promise
      }),
    )
    await chooseAll(user)
    await user.click(submitButton())
    await waitFor(() => expect(submitButton()).toBeDisabled())
    await user.click(screen.getByRole('link', { name: '팀' }))
    await screen.findByRole('heading', { level: 1, name: '팀' })

    act(() => response.resolve())
    const processing = await within(
      screen.getByRole('navigation', { name: '주요 화면' }),
    ).findByRole('link', { name: '정리 중' })
    expect(processing).toHaveAttribute('href', PROCESSING_PATH)
    // 늦은 이동은 transition 이라 한 번 기다린 뒤에 그 화면에 남았는지 본다
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)))
    expect(screen.getByRole('heading', { level: 1, name: '팀' })).toBeInTheDocument()
    expect(app.visited().map(({ pathname }) => pathname)).not.toContain(PROCESSING_PATH)
  })

  it('409 가 이미 처리 중이면 만료로 읽지 않고 처리 화면으로 잇는다', async () => {
    const user = userEvent.setup()
    await openSpeakers()
    server.use(
      http.put('/api/v1/meetings/:meetingId/speakers', () => {
        db.meetings.find(({ meeting_id }) => meeting_id === AWAITING_MEETING_ID)!.status =
          'processing'
        return fail('MEETING_NOT_AWAITING_SPEAKERS', 'x', 409, { status: 'processing' })
      }),
    )
    await chooseAll(user)
    await user.click(submitButton())
    expect(await screen.findByText('다른 곳에서 이미 화자를 지정했어요.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '정리 상태 보기' })).toHaveAttribute(
      'href',
      PROCESSING_PATH,
    )
    expect(screen.queryByText('화자 지정 기한이 지났어요')).not.toBeInTheDocument()
  })

  it('400 member_ids 면 그 팀원 선택만 지우고 다시 고르게 한다', async () => {
    const user = userEvent.setup()
    await openSpeakers()
    server.use(
      http.put('/api/v1/meetings/:meetingId/speakers', () =>
        fail('INVALID_REQUEST', 'x', 400, { member_ids: ['mb_02'] }),
      ),
    )
    await user.click(within(group('화자 1')).getByRole('radio', { name: /김서연/ }))
    await user.click(within(group('화자 2')).getByRole('radio', { name: /박민수/ }))
    await user.click(within(group('화자 3')).getByRole('radio', { name: /외부 참석자/ }))
    await user.click(submitButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '워크스페이스를 나간 팀원이 있어 그 선택을 지웠어요',
    )
    expect(within(group('화자 2')).getByRole('radio', { name: /박민수/ })).not.toBeChecked()
    expect(within(group('화자 1')).getByRole('radio', { name: /김서연/ })).toBeChecked()
    expect(screen.getByText('아직 고르지 않은 화자 1명')).toBeInTheDocument()
  })

  it('내는 중에는 다시 누를 수 없다', async () => {
    const user = userEvent.setup()
    const log = recordRequests()
    await openSpeakers()
    let release: () => void = () => {}
    server.use(
      http.put('/api/v1/meetings/:meetingId/speakers', async () => {
        await new Promise<void>((resolve) => (release = resolve))
        return fail('INVALID_REQUEST', 'x', 400, { member_ids: ['mb_99'] })
      }),
    )
    await chooseAll(user)
    await user.click(submitButton())
    await waitFor(() => expect(submitButton()).toBeDisabled())
    await user.click(submitButton())
    act(() => release())
    await screen.findByRole('alert')
    expect(log.started.filter(({ method }) => method === 'PUT')).toHaveLength(1)
  })
})

describe('화자 지정 화면 — 샘플 재생', () => {
  it('샘플 버튼은 그 구간으로 옮겨 틀고, 다시 누르면 멈춘다', async () => {
    const user = userEvent.setup()
    await openSpeakers()
    const audio = document.querySelector('audio')!
    expect(audio).toHaveAttribute('preload', 'metadata')
    expect(audio.getAttribute('src')).toBe(`/api/v1/meetings/${AWAITING_MEETING_ID}/audio`)
    const second = within(card('화자 1')).getByRole('button', { name: '화자 1 샘플 2 듣기' })
    expect(second).toHaveAttribute('aria-pressed', 'false')
    await user.click(second)
    expect(audio.currentTime).toBe(48.2)
    expect(play).toHaveBeenCalledTimes(1)
    const playing = within(card('화자 1')).getByRole('button', { name: '화자 1 샘플 2 멈추기' })
    expect(playing).toHaveAttribute('aria-pressed', 'true')
    await user.click(playing)
    expect(pause).toHaveBeenCalled()
    expect(
      within(card('화자 1')).getByRole('button', { name: '화자 1 샘플 2 듣기' }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('다른 샘플을 누르면 앞 재생을 끊고 새 구간을 튼다', async () => {
    const user = userEvent.setup()
    await openSpeakers()
    const audio = document.querySelector('audio')!
    await user.click(screen.getByRole('button', { name: '화자 1 샘플 1 듣기' }))
    await user.click(screen.getByRole('button', { name: '화자 2 샘플 1 듣기' }))
    expect(audio.currentTime).toBe(14)
    expect(screen.getByRole('button', { name: '화자 1 샘플 1 듣기' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: '화자 2 샘플 1 멈추기' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('0.8초 샘플도 끝에 닿으면 바로 멈춘다', async () => {
    const user = userEvent.setup()
    await openSpeakers()
    const audio = document.querySelector('audio')!
    await user.click(screen.getByRole('button', { name: '화자 3 샘플 1 듣기' }))
    expect(audio.currentTime).toBe(70.3)
    await screen.findByRole('button', { name: '화자 3 샘플 1 멈추기' })
    pause.mockClear()
    audio.currentTime = 71.1
    expect(await screen.findByRole('button', { name: '화자 3 샘플 1 듣기' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(pause).toHaveBeenCalled()
  })

  it('녹음을 불러오지 못하면 알리고 재생 버튼을 막는다', async () => {
    await openSpeakers()
    act(() => {
      document.querySelector('audio')!.dispatchEvent(new Event('error'))
    })
    expect(
      await screen.findByText('녹음을 불러오지 못했어요. 샘플 없이 골라도 돼요.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '화자 1 샘플 1 듣기' })).toBeDisabled()
  })

  it('녹음이 없으면(audio: null) 재생기와 버튼 없이 안내만 하고 고를 수는 있다', async () => {
    const user = userEvent.setup()
    await openSpeakers('meeting-speakers-no-audio')
    expect(document.querySelector('audio')).toBeNull()
    expect(screen.queryByRole('button', { name: /샘플/ })).not.toBeInTheDocument()
    expect(screen.getByText(/녹음이 남아 있지 않아 샘플을 들을 수 없어요/)).toBeInTheDocument()
    await chooseAll(user)
    expect(submitButton()).toBeEnabled()
  })
})

describe('화자 지정 화면 — 팀원·대기 아님', () => {
  it('팀원은 안내만 보고 화자 API 를 부르지 않는다', async () => {
    replaceDb(createSpeakerScenarioDb('meeting-speakers-member'))
    const log = recordRequests()
    renderApp(SPEAKERS_PATH)
    expect(
      await screen.findByRole('heading', { name: 'PM이 화자를 지정하고 있어요' }),
    ).toBeInTheDocument()
    expect(log.started.filter(({ path }) => /\/speakers|\/audio/.test(path))).toEqual([])
  })

  it('새로고침·직접 진입에도 열리고, 이미 정리 중인 회의면 처리 화면으로 잇는다', async () => {
    replaceDb(createSpeakerScenarioDb('meeting-speakers'))
    db.meetings.find(({ meeting_id }) => meeting_id === AWAITING_MEETING_ID)!.status = 'processing'
    db.meetingFlow.speakers[AWAITING_MEETING_ID].mapping = { SPEAKER_00: null }
    renderApp(SPEAKERS_PATH)
    expect(await screen.findByRole('heading', { name: '회의를 정리하고 있어요' })).toBeVisible()
    expect(screen.getByRole('link', { name: '정리 상태 보기' })).toHaveAttribute(
      'href',
      PROCESSING_PATH,
    )
  })

  it('없는 회의는 볼 수 없다고 안내한다', async () => {
    replaceDb(createSpeakerScenarioDb('meeting-speakers'))
    renderApp(paths.meetingSpeakers('ws_01', 'mt_404'))
    expect(await screen.findByRole('heading', { name: '이 회의를 볼 수 없어요' })).toBeVisible()
  })
})
