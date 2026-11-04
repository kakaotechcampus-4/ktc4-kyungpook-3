import type { Message, MessageReview } from '@/entities/message'
import {
  avatarText,
  awaitingDays,
  clockTime,
  dayLabel,
  fromSeoulInputValue,
  groupByDay,
  initialCustomTime,
  nowLabel,
  relativeDay,
  reviewDateLabel,
  shortDate,
  shortDateTime,
  toSeoulInputValue,
} from './format'

const message = (id: string, sentAt: string): Message => ({
  id,
  sender: 'bot',
  body: id,
  sentAt,
  status: 'sent',
  delivery: 'auto',
  approvedBy: null,
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

it('첫 메시지부터 시각을 읽을 수 없으면 날짜 없는 묶음으로 둔다', () => {
  const days = groupByDay([
    message('a', 'not-a-time'),
    message('b', ''),
    message('c', '2026-09-08T09:02:00+09:00'),
    message('d', 'not-a-time'),
  ])
  expect(days.map(({ date, messages }) => [date, messages.map(({ id }) => id)])).toEqual([
    [null, ['a', 'b']],
    ['2026-09-08', ['c', 'd']],
  ])
})

it('아바타 글자는 이름의 첫 글자, 채널은 # 이다', () => {
  expect(avatarText('이재환', 'direct')).toBe('이')
  expect(avatarText('  ', 'direct')).toBe('?')
  expect(avatarText('#회의록 요약', 'channel')).toBe('#')
})

it('나갈 시각은 `월/일 시:분` 이다', () => {
  expect(shortDateTime('2026-09-23T09:00:00+09:00')).toBe('09/23 09:00')
  expect(shortDateTime('2026-09-22T15:30:00Z')).toBe('09/23 00:30')
})

it('만든 때는 오늘 기준 상대 표기다 — 오늘 · 어제 · N일 전', () => {
  const today = '2026-09-18'
  expect(relativeDay('2026-09-18T08:00:00+09:00', today)).toBe('오늘')
  expect(relativeDay('2026-09-17T23:59:00+09:00', today)).toBe('어제')
  expect(relativeDay('2026-09-15T10:00:00+09:00', today)).toBe('3일 전')
  // UTC 로는 9월 14일이지만 한국 시간으로는 15일이다
  expect(relativeDay('2026-09-14T15:30:00Z', today)).toBe('3일 전')
  expect(relativeDay('not-a-time', today)).toBe('')
})

it('보내기 전 확인 행은 마감이 있으면 마감일, 없으면 만든 때를 쓴다', () => {
  const review = {
    deadline: '2026-09-24',
    createdAt: '2026-09-15T10:00:00+09:00',
  } as MessageReview
  expect(reviewDateLabel(review, '2026-09-18')).toBe('09/24 마감')
  expect(reviewDateLabel({ ...review, deadline: null }, '2026-09-18')).toBe('3일 전')
})

it('답장이 없는 날은 보낸 날을 1일째로 센다', () => {
  expect(awaitingDays('2026-09-16T18:00:00+09:00', '2026-09-18')).toBe(3)
  expect(awaitingDays('2026-09-18T08:00:00+09:00', '2026-09-18')).toBe(1)
  expect(awaitingDays('2026-09-30T08:00:00+09:00', '2026-09-18')).toBe(1)
})

it('지금 바로 카드의 부제는 한국 시간의 요일과 때다', () => {
  expect(nowLabel(new Date('2026-09-18T09:00:00+09:00'))).toBe('금요일 아침')
  expect(nowLabel(new Date('2026-09-18T13:00:00Z'))).toBe('금요일 밤')
  expect(nowLabel(new Date('2026-09-18T19:30:00Z'))).toBe('토요일 새벽')
  expect(nowLabel(new Date('2026-09-20T03:00:00Z'))).toBe('일요일 낮')
})

it('직접 정하기 입력값은 한국 시각으로 오가고, 처음 값은 정한 시각이나 내일 09:00 이다', () => {
  expect(toSeoulInputValue('2026-09-25T05:30:00Z')).toBe('2026-09-25T14:30')
  expect(fromSeoulInputValue('2026-09-25T14:30')).toBe('2026-09-25T14:30:00+09:00')
  expect(fromSeoulInputValue('')).toBeNull()
  expect(fromSeoulInputValue('2026-09-25')).toBeNull()
  expect(initialCustomTime(null, '2026-09-18')).toBe('2026-09-19T09:00')
  expect(initialCustomTime('2026-09-25T14:30:00+09:00', '2026-09-18')).toBe('2026-09-25T14:30')
})
