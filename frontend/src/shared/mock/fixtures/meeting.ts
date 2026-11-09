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
    deletion_available: true,
    // 백엔드 _compute_progress 는 status 가 아니라 발화 저장 여부와 최신 추출의 items 로 계산한다.
    // ex_00 은 items 가 비어 있어 extracted 가 false 다. 단계를 알린 회의(#383 뒤)라면 true 다 (계약 §2.3).
    // done 인데 추출 항목이 0건인 회의 — 할 일이 안 나온 회의다
    progress: { audio_merged: true, transcribed: true, extracted: false },
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
    deletion_available: true,
    // ex_01 은 items 6건이라 세 단계가 다 끝났다
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
    deletion_available: true,
    // 전사 중이다 — #383 뒤 AI 가 stt 를 알린 회의의 값이다. 진행률 UI 가 밟는 중간 단계
    progress: { audio_merged: true, transcribed: false, extracted: false },
  },
  {
    // 채팅 회의 (#379). 녹음이 없고, 시작·끝은 첫 메시지·마지막 메시지 시각이다. 서울 시각으로 하루를 넘는다
    meeting_id: 'mt_08',
    workspace_id: 'ws_01',
    title: '채팅 2026-09-11',
    status: 'done',
    started_at: '2026-09-11T00:12:00Z',
    ended_at: '2026-09-11T23:40:00Z',
    extraction_id: 'ex_02',
    failed_stage: null,
    deletion_available: true,
    progress: null,
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
  {
    meeting_id: 'mt_08',
    title: '채팅 2026-09-11',
    status: 'done',
    source: 'chat',
    started_at: '2026-09-11T00:12:00Z',
    duration_ms: 84_480_000,
    attendee_count: 3,
    processed_at: '2026-09-12T00:03:00Z',
  },
]
