import type { Bundle, BundleTask } from '@/entities/message'
import {
  avatarText,
  awaitingDays,
  bundleDateLabel,
  bundleSummary,
  clockTime,
  dayLabel,
  earliestDue,
  groupByDay,
  shortDate,
  shortDateTime,
} from './format'

const message = (id: string, at: string) => ({ id, at })

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
  expect(days.map(({ date, items }) => [date, items.map(({ id }) => id)])).toEqual([
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
  expect(days.map(({ date, items }) => [date, items.map(({ id }) => id)])).toEqual([
    [null, ['a', 'b']],
    ['2026-09-08', ['c', 'd']],
  ])
})

it('아바타 글자는 이름의 첫 글자다', () => {
  expect(avatarText('이재환')).toBe('이')
  expect(avatarText('  ')).toBe('?')
})

it('나갈 시각은 `월/일 시:분` 이다', () => {
  expect(shortDateTime('2026-09-23T09:00:00+09:00')).toBe('09/23 09:00')
  expect(shortDateTime('2026-09-22T15:30:00Z')).toBe('09/23 00:30')
})

const task = (dueDate: string | null, title: string | null = '태스크'): BundleTask => ({
  reminderId: `rm_${title ?? 'x'}`,
  taskId: null,
  title,
  dueDate,
  note: null,
})

it('가장 이른 마감은 마감 없는 태스크를 건너뛰고, 모두 없으면 null 이다', () => {
  expect(earliestDue([task(null), task('2026-09-30'), task('2026-09-24')])).toBe('2026-09-24')
  expect(earliestDue([task(null)])).toBeNull()
  expect(earliestDue([])).toBeNull()
})

it('보내기 전 확인 행은 승인했으면 발송 예정, 아니면 가장 이른 마감, 마감이 없으면 예정 시각을 쓴다', () => {
  const bundle = {
    stage: 'awaitingApproval',
    scheduledAt: '2026-09-23T00:00:00Z',
    tasks: [task('2026-09-30', '발표 자료'), task('2026-09-24', 'API 명세서')],
  } as Bundle
  expect(bundleDateLabel(bundle)).toBe('09/24 마감')
  expect(bundleDateLabel({ ...bundle, tasks: [task(null)] })).toBe('09/23 예정')
  expect(
    bundleDateLabel({ ...bundle, stage: 'approved', approvedAt: '2026-09-18T00:00:00Z' }),
  ).toBe('09/23 발송 예정')
  expect(bundleSummary(bundle)).toBe('발표 자료 외 1건')
  expect(bundleSummary({ ...bundle, tasks: [task(null, null)] })).toBe('지워진 태스크')
})

it('답장이 없는 날은 보낸 날을 1일째로 센다', () => {
  expect(awaitingDays('2026-09-16T18:00:00+09:00', '2026-09-18')).toBe(3)
  expect(awaitingDays('2026-09-18T08:00:00+09:00', '2026-09-18')).toBe(1)
  expect(awaitingDays('2026-09-30T08:00:00+09:00', '2026-09-18')).toBe(1)
})
