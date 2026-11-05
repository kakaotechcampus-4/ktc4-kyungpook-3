import { initialDb } from './db'
import type { MockDb, MockSpeakerUpload } from './db'
import { completeMeeting, setMeetingFlowMode } from './meetingFlow'
import { setMockRole } from './sessions'
import { awaitSpeakers, registerSpeakerUpload } from './speakerFlow'

export const SPEAKER_SCENARIOS = [
  'meeting-speakers',
  'meeting-speakers-flow',
  'meeting-speakers-expired',
  'meeting-speakers-member',
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
