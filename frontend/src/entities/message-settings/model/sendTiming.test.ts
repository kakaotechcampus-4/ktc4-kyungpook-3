import { deadlineSend, initialCustomTime, sameInstant } from './sendTiming'

it('마감 기준 시각은 마감에 재촉 규칙을 적용한 한국 시간이고, 마감이 없거나 지났으면 고를 수 없다', () => {
  const now = Date.parse('2026-09-18T09:00:00+09:00')
  const dayBefore = { daysBefore: 1, hour: 9 } as const
  expect(deadlineSend('2026-09-24', dayBefore, now)).toEqual({
    status: 'open',
    at: '2026-09-23T09:00:00+09:00',
  })
  expect(deadlineSend('2026-09-24', { daysBefore: 2, hour: 18 }, now)).toEqual({
    status: 'open',
    at: '2026-09-22T18:00:00+09:00',
  })
  expect(deadlineSend('2026-09-18', { daysBefore: 0, hour: 18 }, now)).toEqual({
    status: 'open',
    at: '2026-09-18T18:00:00+09:00',
  })
  expect(deadlineSend(null, dayBefore, now)).toEqual({ status: 'none' })
  expect(deadlineSend('2026-09-19', dayBefore, now)).toEqual({
    status: 'passed',
    at: '2026-09-18T09:00:00+09:00',
  })
})

it('서버의 UTC 와 화면의 +09:00 이 같은 순간이면 같다', () => {
  expect(sameInstant('2026-09-23T00:00:00.000Z', '2026-09-23T09:00:00+09:00')).toBe(true)
  expect(sameInstant('2026-09-23T00:00:00Z', '2026-09-23T09:01:00+09:00')).toBe(false)
})

it('직접 정하기의 처음 값은 정한 시각이나 내일 09:00 이다', () => {
  expect(initialCustomTime(null, '2026-09-18')).toBe('2026-09-19T09:00')
  expect(initialCustomTime('2026-09-25T14:30:00+09:00', '2026-09-18')).toBe('2026-09-25T14:30')
})
