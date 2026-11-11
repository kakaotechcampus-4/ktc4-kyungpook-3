import type { MeetingDto, MeetingSummaryDto, SpeakerViewDto } from '@/shared/types/api/meeting'
import { db } from './db'
import type { MockDb, MockSpeakerUpload } from './db'
import { speakerLabelFixtures } from './fixtures/speaker'
import { MOCK_RECORDING_SECONDS, audioUnavailableReason } from './meetingAudio'
import { silentWavSize } from './speakerAudio'

/*
 * 업로드 회의의 화자 지정 흐름 (계약 §2.3.1, backend services/speaker_assignment.py).
 * processing → (AI 가 라벨을 보냄) awaiting_speakers → (PM 이 지정을 냄) processing → done | failed.
 * 함수는 meetingFlow.ts 처럼 `state` 를 받는다. handler 는 `db` 를, 시나리오는 아직 `db` 에 넣지 않은 상태를 넘긴다.
 */

function meetingOf(state: MockDb, meetingId: string): MeetingDto {
  const meeting = state.meetings.find(({ meeting_id }) => meeting_id === meetingId)
  if (!meeting) throw new Error(`mock meeting ${meetingId} is missing`)
  return meeting
}

function setSummaryStatus(
  state: MockDb,
  meetingId: string,
  status: MeetingSummaryDto['status'],
): void {
  const summary = state.meetingSummaries.find(({ meeting_id }) => meeting_id === meetingId)
  if (summary) summary.status = status
}

export function registerSpeakerUpload(
  meetingId: string,
  options: Partial<MockSpeakerUpload> = {},
  state: MockDb = db,
): MockSpeakerUpload {
  const upload: MockSpeakerUpload = {
    speakers: [],
    mapping: null,
    audio: true,
    expireOnSubmit: false,
    ...options,
  }
  state.meetingFlow.speakers[meetingId] = upload
  return upload
}

export function awaitSpeakers(
  meetingId: string,
  speakers: SpeakerViewDto['speakers'] = speakerLabelFixtures,
  state: MockDb = db,
): MeetingDto {
  const meeting = meetingOf(state, meetingId)
  const upload =
    state.meetingFlow.speakers[meetingId] ?? registerSpeakerUpload(meetingId, {}, state)
  if (meeting.status !== 'processing')
    throw new Error(`mock meeting ${meetingId} is ${meeting.status}, not processing`)
  upload.speakers = structuredClone(speakers)
  meeting.status = 'awaiting_speakers'
  meeting.progress = { audio_merged: true, transcribed: false, extracted: false }
  setSummaryStatus(state, meetingId, 'awaiting_speakers')
  return meeting
}

export function needsSpeakers(meetingId: string, state: MockDb = db): boolean {
  return state.meetingFlow.speakers[meetingId]?.mapping === null
}

function candidatesOf(state: MockDb, meeting: MeetingDto): SpeakerViewDto['candidates'] {
  return (state.meetingFlow.attendees[meeting.meeting_id] ?? []).flatMap((id) =>
    state.members
      .filter(
        ({ member_id, workspace_id }) => member_id === id && workspace_id === meeting.workspace_id,
      )
      .map(({ member_id, display_name }) => ({ member_id, display_name })),
  )
}

export function speakerViewOf(
  meeting: MeetingDto,
  upload: MockSpeakerUpload,
  state: MockDb = db,
): SpeakerViewDto {
  return {
    meeting_id: meeting.meeting_id,
    status: meeting.status,
    speakers: [...upload.speakers].sort(
      (a, b) => b.total_sec - a.total_sec || a.label.localeCompare(b.label),
    ),
    candidates: candidatesOf(state, meeting),
    mapping: upload.mapping,
    // 처리가 끝나도 보관 기간(7일) 동안은 녹음이 있다. 실패한 회의는 바로 지운다 (#676)
    audio:
      audioUnavailableReason(meeting, state) === null
        ? { content_type: 'audio/wav', size_bytes: silentWavSize(MOCK_RECORDING_SECONDS) }
        : null,
  }
}

export type AssignResult =
  | { kind: 'assigned'; status: string }
  | { kind: 'invalid'; details: Record<string, string[]> }
  | { kind: 'notAwaiting'; status: string }

function sameMapping(
  saved: Record<string, string | null> | null,
  mapping: Record<string, string | null>,
): boolean {
  if (saved === null) return false
  const keys = Object.keys(mapping)
  return (
    keys.length === Object.keys(saved).length &&
    keys.every((key) => Object.hasOwn(saved, key) && saved[key] === mapping[key])
  )
}

/**
 * PM 의 지정을 받는다. 백엔드 assign_speakers 와 같은 순서다 — 저장된 것과 같으면 지금 상태로 성공, 대기가 아니면 409,
 * 라벨·팀원이 틀리면 아무것도 바꾸지 않고 400, 맞으면 저장하고 processing 으로 옮긴다.
 * `expireOnSubmit` 은 제출 직전에 기한 만료가 이긴 경우다 — 회의가 실패로 끝나고 409 다
 */
export function assignMockSpeakers(
  meetingId: string,
  mapping: Record<string, string | null>,
  state: MockDb = db,
): AssignResult {
  const meeting = meetingOf(state, meetingId)
  const upload = state.meetingFlow.speakers[meetingId]
  if (!upload) throw new Error(`mock meeting ${meetingId} has no upload`)
  if (sameMapping(upload.mapping, mapping)) return { kind: 'assigned', status: meeting.status }
  if (meeting.status === 'awaiting_speakers' && upload.expireOnSubmit) {
    meeting.status = 'failed'
    meeting.failed_stage = 'speaker_assignment_expired'
    setSummaryStatus(state, meetingId, 'failed')
  }
  if (meeting.status !== 'awaiting_speakers') return { kind: 'notAwaiting', status: meeting.status }

  const reported = new Set(upload.speakers.map(({ label }) => label))
  const given = Object.keys(mapping)
  const details: Record<string, string[]> = {}
  const unknown = given.filter((label) => !reported.has(label)).sort()
  const missing = [...reported].filter((label) => !Object.hasOwn(mapping, label)).sort()
  const members = new Set(
    state.members
      .filter(({ workspace_id }) => workspace_id === meeting.workspace_id)
      .map(({ member_id }) => member_id),
  )
  const badMembers = [
    ...new Set(
      Object.values(mapping).filter((id): id is string => id !== null && !members.has(id)),
    ),
  ].sort()
  if (unknown.length > 0) details.unknown_labels = unknown
  if (missing.length > 0) details.missing_labels = missing
  if (badMembers.length > 0) details.member_ids = badMembers
  if (Object.keys(details).length > 0) return { kind: 'invalid', details }

  upload.mapping = { ...mapping }
  meeting.status = 'processing'
  setSummaryStatus(state, meetingId, 'processing')
  return { kind: 'assigned', status: meeting.status }
}
