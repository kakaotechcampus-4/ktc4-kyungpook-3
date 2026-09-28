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
  expect(minutes.summary?.keyPoints).toHaveLength(2)
})

// 백엔드 MeetingMinutesResponse 는 summary·title 이 nullable 이고, 실 API 는 요약을 채우는
// 경로가 없어 항상 null 을 준다 (계약 §4.0-②-11). 화면이 "요약 없음" 을 정상 상태로 다뤄야 한다
it('keeps a null summary and an absent title as normal values', () => {
  const dto = { ...structuredClone(minutesFixtures[0]), summary: null, title: null }
  expect(toMinutes(dto)).toMatchObject({ title: '', summary: null })
})

it('preserves false permissions and does not treat an empty display name as null', () => {
  const dto = structuredClone(minutesFixtures[1])
  dto.permissions = { can_review: false, can_undo: false }
  dto.transcript[0].speaker_display_name = ''
  expect(toMinutes(dto)).toMatchObject({ canReview: false, canUndo: false })
  expect(toMinutes(dto).transcript[0]).toMatchObject({ speakerName: '', isFallbackName: false })
})
