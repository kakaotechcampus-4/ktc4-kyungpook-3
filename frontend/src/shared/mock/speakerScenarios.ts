import { initialDb } from './db'
import type { MockDb, MockSpeakerUpload } from './db'
import { completeMeeting, setMeetingFlowMode } from './meetingFlow'
import { setMockRole } from './sessions'
import { awaitSpeakers, registerSpeakerUpload } from './speakerFlow'

/*
 * 화자 지정(#256) 시나리오. 모두 ws_01 하나에 로그인하고, 픽스처의 처리 중 회의(mt_10)는 먼저 완료해 둔다.
 * 흐름 방식은 `speakers` 다 — 지정을 내면 상세 조회마다 한 단계씩 진행해 완료된다.
 * scenarios.ts 의 목록과 createScenarioDb 가 여기로 넘긴다.
 */
export const SPEAKER_SCENARIOS = [
  // 업로드 회의 mt_11 이 처음부터 화자 지정 대기다. 회의록 목록의 진행 중 묶음에 보인다
  'meeting-speakers',
  // 업로드 → 정리 중 → 화자 지정 대기 → 지정 → 정리 중 → 완료. 업로드 뒤 첫 상세 조회에 대기가 된다
  'meeting-speakers-flow',
  // mt_11 에 지정을 내면 그 순간 기한이 지나 409 `details.status=failed`, 상세는 speaker_assignment_expired
  'meeting-speakers-expired',
  // 일반 팀원이 대기 중인 mt_11 을 본다. 화자 API 는 PM 만 쓴다
  'meeting-speakers-member',
  // mt_11 의 녹음이 없다(`audio: null`). 샘플 없이 고른다
  'meeting-speakers-no-audio',
] as const
export type SpeakerScenario = (typeof SPEAKER_SCENARIOS)[number]

export function isSpeakerScenario(value: string): value is SpeakerScenario {
  return (SPEAKER_SCENARIOS as readonly string[]).includes(value)
}

export const AWAITING_MEETING_ID = 'mt_11'

function signInToWs01(state: MockDb): void {
  const account = state.accounts[0]
  account.workspaceIds = ['ws_01']
  account.session.workspace_count = 1
  account.session.last_workspace_id = 'ws_01'
  state.session = structuredClone(account.session)
  state.authenticated = true
}

/** 업로드 때 김서연·박민수·이재환을 참석자로 고른 회의. 정하늘(mb_04)은 「다른 팀원」이다 */
function addAwaitingUpload(state: MockDb, upload: Partial<MockSpeakerUpload> = {}): void {
  const meetingId = AWAITING_MEETING_ID
  const startedAt = '2026-09-19T01:00:00Z'
  state.meetings.push({
    meeting_id: meetingId,
    workspace_id: 'ws_01',
    title: '주간 회고 녹음',
    status: 'processing',
    started_at: startedAt,
    ended_at: null,
    extraction_id: null,
    failed_stage: null,
    progress: { audio_merged: false, transcribed: false, extracted: false },
  })
  state.meetingSummaries.push({
    meeting_id: meetingId,
    title: '주간 회고 녹음',
    status: 'processing',
    source: 'manual_upload',
    started_at: startedAt,
    duration_ms: null,
    attendee_count: 3,
    processed_at: null,
  })
  state.meetingFlow.attendees[meetingId] = ['mb_01', 'mb_02', 'mb_03']
  registerSpeakerUpload(meetingId, upload, state)
  awaitSpeakers(meetingId, undefined, state)
}

export function createSpeakerScenarioDb(scenario: SpeakerScenario): MockDb {
  const state = initialDb()
  signInToWs01(state)
  completeMeeting('mt_10', state)
  setMeetingFlowMode('speakers', state)
  switch (scenario) {
    case 'meeting-speakers':
      addAwaitingUpload(state)
      break
    case 'meeting-speakers-flow':
      break
    case 'meeting-speakers-expired':
      addAwaitingUpload(state, { expireOnSubmit: true })
      break
    case 'meeting-speakers-member':
      setMockRole('member', 'ws_01', state)
      addAwaitingUpload(state)
      break
    case 'meeting-speakers-no-audio':
      addAwaitingUpload(state, { audio: false })
      break
  }
  return state
}
