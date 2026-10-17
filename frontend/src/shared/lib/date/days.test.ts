import { SOON_LAST_DAY_OFFSET, addDays, soonUntil } from './days'

describe('날짜 전용 값 계산 (M6 목록·M7 대시보드 공통)', () => {
  it('7일 이내는 오늘 포함 7개 날짜라 마지막 날이 오늘 + 6일이다', () => {
    expect(SOON_LAST_DAY_OFFSET).toBe(6)
    expect(soonUntil('2026-09-18')).toBe('2026-09-24')
  })

  it.each([
    ['2026-09-28', 6, '2026-10-04'],
    ['2026-12-29', 6, '2027-01-04'],
    ['2028-02-25', 6, '2028-03-02'],
    ['2027-02-25', 6, '2027-03-03'],
    ['2026-01-01', -1, '2025-12-31'],
  ])('%s + %i일 = %s (월·연·윤년 경계)', (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected)
  })

  describe('실행 환경 시간대와 무관하다', () => {
    const original = process.env.TZ
    afterEach(() => {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    })

    it.each(['Pacific/Honolulu', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Seoul'])(
      '%s',
      (timeZone) => {
        process.env.TZ = timeZone
        expect(soonUntil('2026-12-29')).toBe('2027-01-04')
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
      },
    )
  })
})
