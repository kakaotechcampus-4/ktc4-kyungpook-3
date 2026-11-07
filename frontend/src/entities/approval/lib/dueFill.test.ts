import { dueFillSuggestion } from './dueFill'

/* 회의 mt_09 는 2026-09-15(화, 서울)다. 그 주 월요일이 09-14 라 `다음 주 월요일` 은 09-21 이다 */
const MEETING_DATE = '2026-09-15'

describe('마감 채우기 제안', () => {
  it('AI 가 날짜를 정하지 못한 승인의 말이 확실하면 회의 날짜 기준 날짜를 제안한다', () => {
    expect(dueFillSuggestion({ dueDate: null, dueRaw: '다음 주 월요일' }, MEETING_DATE)).toBe(
      '2026-09-21',
    )
  })

  it.each([
    ['AI 가 이미 날짜를 정했다', { dueDate: '2026-09-25', dueRaw: '다음 주 월요일' }, MEETING_DATE],
    ['한 말이 없다', { dueDate: null, dueRaw: null }, MEETING_DATE],
    ['한 말이 비었다', { dueDate: null, dueRaw: '' }, MEETING_DATE],
    ['회의 날짜를 모른다', { dueDate: null, dueRaw: '내일' }, null],
    ['한 말이 날짜 하나로 정해지지 않는다', { dueDate: null, dueRaw: '배포 전' }, MEETING_DATE],
  ])('%s → 제안하지 않는다', (_, approval, meetingDate) => {
    expect(dueFillSuggestion(approval, meetingDate)).toBeNull()
  })
})
