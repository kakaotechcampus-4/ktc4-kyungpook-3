import { toMeeting, toMeetingSummary } from './mapper'
import { meetingFixtures, meetingSummaryFixtures } from '@/shared/mock/fixtures/meeting'

it('maps detail and summary independently including the required progress', () => {
  expect(toMeeting(meetingFixtures[1])).toEqual({
    id: 'mt_09',
    workspaceId: 'ws_01',
    title: '3주차 정기회의',
    status: 'done',
    startedAt: '2026-09-15T05:00:00Z',
    endedAt: '2026-09-15T05:45:30Z',
    extractionId: 'ex_01',
    failedStage: null,
    // 백엔드가 필수로 내려주므로 픽스처에도 있다 (계약 §2.3, §4.7-1)
    progress: { audioMerged: true, transcribed: true, extracted: true },
  })
  expect(toMeetingSummary(meetingSummaryFixtures[2])).toEqual({
    id: 'mt_10',
    title: '기획 논의 녹음',
    status: 'processing',
    source: 'manual_upload',
    startedAt: '2026-09-18T00:30:00Z',
    durationMs: null,
    attendeeCount: 4,
    processedAt: null,
  })
})

it('preserves nullable fields and keeps the processing progress shape', () => {
  expect(toMeeting({ ...meetingFixtures[2], title: null, ended_at: null })).toMatchObject({
    title: '',
    endedAt: null,
    extractionId: null,
    // processing 회의는 중간 단계다
    progress: { audioMerged: true, transcribed: false, extracted: false },
  })
})

// DTO 가 progress 를 옵셔널로 둔 이유 — Zod 가 없어(D-134) 서버가 빠뜨리면 런타임에 터진다.
// 계약상 항상 오지만 매퍼의 null 분기는 방어로 남긴다 (M1 사양서 §6-4)
it('treats a missing progress as null instead of throwing', () => {
  const dto = { ...structuredClone(meetingFixtures[1]), progress: undefined }
  expect(toMeeting(dto).progress).toBeNull()
})

it('falls back unknown status and source without throwing', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    expect(
      toMeetingSummary({ ...meetingSummaryFixtures[0], status: 'future', source: 'future' }),
    ).toMatchObject({ status: 'created', source: 'discord' })
    expect(warning).toHaveBeenCalledTimes(2)
  } finally {
    warning.mockRestore()
  }
})

// 백엔드 Meeting.title 이 nullable 이고 목록은 그 값을 그대로 내린다. items 가 list[dict] 라
// 스키마로는 드러나지 않는다 (계약 §4.0-②-14). 단건과 같은 폴백으로 도메인 계약을 지킨다
it('falls back a null list title to an empty string like the detail mapper does', () => {
  expect(toMeetingSummary({ ...meetingSummaryFixtures[0], title: null }).title).toBe('')
})
