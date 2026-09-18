import { toMeeting, toMeetingSummary } from './mapper'
import { meetingFixtures, meetingSummaryFixtures } from '@/shared/mock/fixtures/meeting'

it('maps detail and summary independently and treats missing progress as normal', () => {
  expect(toMeeting(meetingFixtures[1])).toEqual({
    id: 'mt_09',
    workspaceId: 'ws_01',
    title: '3주차 정기회의',
    status: 'done',
    startedAt: '2026-09-15T05:00:00Z',
    endedAt: '2026-09-15T05:45:30Z',
    extractionId: 'ex_01',
    failedStage: null,
    progress: null,
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

it('preserves nullable fields and maps recovered progress', () => {
  expect(
    toMeeting({
      ...meetingFixtures[2],
      title: null,
      ended_at: null,
      progress: { audio_merged: true, transcribed: false, extracted: false },
    }),
  ).toMatchObject({
    title: '',
    endedAt: null,
    extractionId: null,
    progress: { audioMerged: true, transcribed: false, extracted: false },
  })
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
