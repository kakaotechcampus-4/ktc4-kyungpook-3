import type { Message } from '@/entities/message'
import { avatarText, clockTime, dayLabel, groupByDay, shortDate } from './format'

const message = (id: string, sentAt: string): Message => ({
  id,
  sender: 'bot',
  body: id,
  sentAt,
})

it('목록 날짜와 말풍선 시각은 한국 시간이다', () => {
  // UTC 로는 9월 9일 15:30 — 한국 시간으로는 다음 날 00:30 이다
  expect(shortDate('2026-09-09T15:30:00Z')).toBe('09/10')
  expect(clockTime('2026-09-09T15:30:00Z')).toBe('00:30')
  expect(shortDate('2026-09-10T18:00:00+09:00')).toBe('09/10')
  expect(clockTime('2026-09-10T18:00:00+09:00')).toBe('18:00')
})

it('날짜 구분선은 요일까지 쓰고, 오늘이면 앞에 오늘을 붙인다', () => {
  expect(dayLabel('2026-09-08', '2026-09-18')).toBe('9월 8일 화요일')
  expect(dayLabel('2026-09-18', '2026-09-18')).toBe('오늘 · 9월 18일 금요일')
})

it('메시지를 한국 날짜별로 묶는다 — 자정을 넘긴 UTC 시각은 다음 날이다', () => {
  const days = groupByDay([
    message('a', '2026-09-08T09:02:00+09:00'),
    message('b', '2026-09-08T14:59:00Z'),
    message('c', '2026-09-08T15:00:00Z'),
    message('d', '2026-09-10T18:00:00+09:00'),
  ])
  expect(days.map(({ date, messages }) => [date, messages.map(({ id }) => id)])).toEqual([
    ['2026-09-08', ['a', 'b']],
    ['2026-09-09', ['c']],
    ['2026-09-10', ['d']],
  ])
})

it('아바타 글자는 이름의 첫 글자, 채널은 # 이다', () => {
  expect(avatarText('이재환', 'direct')).toBe('이')
  expect(avatarText('  ', 'direct')).toBe('?')
  expect(avatarText('#회의록 요약', 'channel')).toBe('#')
})
