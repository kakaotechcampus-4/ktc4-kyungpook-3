import { todayInSeoul } from './today'

it('UTC 날짜가 아닌 서울 날짜를 반환한다', () => {
  expect(todayInSeoul(new Date('2026-09-17T15:00:00Z'))).toBe('2026-09-18')
  expect(todayInSeoul(new Date('2026-09-17T14:59:59Z'))).toBe('2026-09-17')
})
