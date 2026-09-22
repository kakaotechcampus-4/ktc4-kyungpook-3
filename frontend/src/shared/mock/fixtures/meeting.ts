import type { MeetingDto, MeetingSummaryDto } from '@/shared/types/api/meeting'

export const meetingFixtures: MeetingDto[] = [
  {
    meeting_id: 'mt_07',
    workspace_id: 'ws_01',
    title: '2주차 정기회의',
    status: 'done',
    started_at: '2026-09-08T05:00:00Z',
    ended_at: '2026-09-08T05:45:00Z',
    extraction_id: 'ex_00',
    failed_stage: null,
    // done 이면 세 단계가 다 끝나 있다 (백엔드 _compute_progress)
    progress: { audio_merged: true, transcribed: true, extracted: true },
  },
  {
    meeting_id: 'mt_09',
    workspace_id: 'ws_01',
    title: '3주차 정기회의',
    status: 'done',
    started_at: '2026-09-15T05:00:00Z',
    ended_at: '2026-09-15T05:45:30Z',
    extraction_id: 'ex_01',
    failed_stage: null,
    progress: { audio_merged: true, transcribed: true, extracted: true },
  },
  {
    meeting_id: 'mt_10',
    workspace_id: 'ws_01',
    title: '기획 논의 녹음',
    status: 'processing',
    started_at: '2026-09-18T00:30:00Z',
    ended_at: '2026-09-18T01:00:00Z',
    extraction_id: null,
    failed_stage: null,
    // processing 은 중간 단계다. 진행률 UI 가 이 경로를 실제로 밟아야 한다
    progress: { audio_merged: true, transcribed: false, extracted: false },
  },
]
export const meetingSummaryFixtures: MeetingSummaryDto[] = [
  {
    meeting_id: 'mt_07',
    title: '2주차 정기회의',
    status: 'done',
    source: 'discord',
    started_at: '2026-09-08T05:00:00Z',
    duration_ms: 2700000,
    attendee_count: 4,
    processed_at: '2026-09-08T06:00:00Z',
  },
  {
    meeting_id: 'mt_09',
    title: '3주차 정기회의',
    status: 'done',
    source: 'discord',
    started_at: '2026-09-15T05:00:00Z',
    duration_ms: 2730000,
    attendee_count: 4,
    processed_at: '2026-09-15T06:12:00Z',
  },
  {
    meeting_id: 'mt_10',
    title: '기획 논의 녹음',
    status: 'processing',
    source: 'manual_upload',
    started_at: '2026-09-18T00:30:00Z',
    duration_ms: null,
    attendee_count: 4,
    processed_at: null,
  },
]
