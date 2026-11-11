import type { MockInstance } from 'vitest'
import { minutesFixtures } from '@/shared/mock/fixtures/minutes'
import { minutesSchema } from './minutes'

const valid = minutesFixtures[0]

let warning: MockInstance<typeof console.warn>
beforeEach(() => {
  warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warning.mockRestore())

describe('회의록 스키마', () => {
  it('모르는 출처는 거절하지 않는다. 화면이 알 수 없는 출처로 읽는다', () => {
    expect(minutesSchema.safeParse({ ...valid, source: 'zoom' }).success).toBe(true)
  })

  it.each([
    ['문자열 권한', { permissions: { can_review: 'true', can_undo: false } }],
    ['권한 누락', { permissions: undefined }],
    ['숫자가 아닌 길이', { duration_ms: null }],
    ['시각이 없는 전사문 줄', { transcript: [{ ...valid.transcript[0], at_ms: null }] }],
    ['이름이 없는 참석자', { attendees: [{ member_id: 'mb_01' }] }],
  ])('%s 는 읽지 않는다', (_, patch) => {
    expect(minutesSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })

  it.each([
    ['문자열', '회의 요약'],
    ['개요가 없는 객체', { key_points: [], decisions: [] }],
    ['글자가 아닌 결정', { overview: '개요', key_points: [], decisions: [1] }],
  ])('요약이 %s 면 서버처럼 요약이 없는 것으로 보고 전사문은 읽는다', (_, summary) => {
    const parsed = minutesSchema.parse({ ...valid, summary })
    expect(parsed.summary).toBeNull()
    expect(parsed.transcript).toEqual(valid.transcript)
    expect(warning).toHaveBeenCalledWith('Invalid minutes summary:', summary)
  })

  it('요약 상태는 아는 값과 모르는 글자를 남기고, 없거나 글자가 아니면 none 이다', () => {
    expect(
      minutesSchema.parse({ ...valid, summary_status: 'awaiting_approval' }).summary_status,
    ).toBe('awaiting_approval')
    expect(minutesSchema.parse({ ...valid, summary_status: 'regenerating' }).summary_status).toBe(
      'regenerating',
    )
    expect(minutesSchema.parse({ ...valid, summary_status: undefined }).summary_status).toBe('none')
    expect(minutesSchema.parse({ ...valid, summary_status: 3 }).summary_status).toBe('none')
  })

  const waitingCountOf = (value: unknown) =>
    minutesSchema.parse({ ...valid, summary_waiting_count: value }).summary_waiting_count

  it('남은 승인 수는 0 이상의 정수와 null 만 남기고, 없으면 null 이다', () => {
    const older: Record<string, unknown> = { ...valid }
    delete older.summary_waiting_count
    expect(minutesSchema.parse(older).summary_waiting_count).toBeNull()
    expect(waitingCountOf(3)).toBe(3)
    expect(waitingCountOf(0)).toBe(0)
    expect(waitingCountOf(null)).toBeNull()
    expect(warning).not.toHaveBeenCalled()
  })

  it.each([-1, 1.5, '3'])('남은 승인 수가 %j 이면 건수만 빼고 회의록은 읽는다', (count) => {
    const parsed = minutesSchema.parse({ ...valid, summary_waiting_count: count })
    expect(parsed.summary_waiting_count).toBeNull()
    expect(parsed.transcript).toEqual(valid.transcript)
    expect(warning).toHaveBeenCalledWith('Invalid minutes summary_waiting_count:', count)
  })
})

it('MSW 회의록 픽스처가 같은 스키마를 따른다', () => {
  for (const minutes of minutesFixtures) expect(minutesSchema.parse(minutes)).toEqual(minutes)
  expect(warning).not.toHaveBeenCalled()
})
