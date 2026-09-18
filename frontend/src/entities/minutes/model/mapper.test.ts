import { toMinutes } from './mapper'
import { minutesFixtures } from '@/shared/mock/fixtures/minutes'

it('maps attendees, summary, permissions and speaker fallback without interpreting timestamps', () => {
  const minutes = toMinutes(minutesFixtures[1])
  expect(minutes).toMatchObject({
    meetingId: 'mt_09',
    startedAt: '2026-09-15T05:00:00Z',
    source: 'discord',
    canReview: true,
    canUndo: true,
    attendees: [
      { memberId: 'mb_01', displayName: '김서연' },
      { memberId: 'mb_02', displayName: '박민수' },
      { memberId: 'mb_03', displayName: '이재환' },
      { memberId: 'mb_04', displayName: '정하늘' },
    ],
  })
  expect(minutes.transcript[3]).toEqual({
    atMs: 360000,
    speakerMemberId: null,
    speakerName: 'jihun_dev',
    isFallbackName: true,
    text: '다음 주까지 확인할게요.',
  })
  expect(minutes.transcript[0]).toMatchObject({ speakerName: '김서연', isFallbackName: false })
  expect(minutes.summary.keyPoints).toHaveLength(2)
})

it('preserves false permissions and does not treat an empty display name as null', () => {
  const dto = structuredClone(minutesFixtures[1])
  dto.permissions = { can_review: false, can_undo: false }
  dto.transcript[0].speaker_display_name = ''
  expect(toMinutes(dto)).toMatchObject({ canReview: false, canUndo: false })
  expect(toMinutes(dto).transcript[0]).toMatchObject({ speakerName: '', isFallbackName: false })
})
