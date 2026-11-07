import {
  formatSeoulDateTime,
  formatSeoulMonthDayTime,
  fromSeoulInputValue,
  isDateOnly,
  monthDayOf,
  readDateOnly,
  seoulDateOf,
  seoulMidnightIso,
  toSeoulInputValue,
} from './format'

describe('timestamp 는 한국 시간으로 보여 준다', () => {
  it('UTC 자정 전후에서 서울 날짜 경계를 넘는다', () => {
    expect(formatSeoulDateTime('2026-09-17T15:00:00Z')).toBe('2026-09-18 00:00')
    expect(formatSeoulDateTime('2026-09-17T14:59:59Z')).toBe('2026-09-17 23:59')
  })

  it('오프셋이 붙은 값도 서울 시각이다', () => {
    expect(formatSeoulDateTime('2026-09-18T09:00:00+09:00')).toBe('2026-09-18 09:00')
  })

  it('짧은 표기는 MM/DD 와 MM/DD HH:mm 이다', () => {
    expect(monthDayOf('2026-09-08')).toBe('09/08')
    expect(formatSeoulMonthDayTime('2026-09-11T05:22:00Z')).toBe('09/11 14:22')
    expect(formatSeoulMonthDayTime('not a date')).toBe('')
  })

  it('서울 기준 날짜를 뽑는다', () => {
    expect(seoulDateOf('2026-09-17T15:00:00Z')).toBe('2026-09-18')
    expect(seoulDateOf('nope')).toBeNull()
  })

  it('읽을 수 없는 값은 빈 문자열이다', () => {
    expect(formatSeoulDateTime('not a date')).toBe('')
  })
})

describe('날짜 전용 값', () => {
  it.each(['2026-09-18', '2024-02-29', '2026-12-31'])('%s 는 날짜 전용 값이다', (value) => {
    expect(isDateOnly(value)).toBe(true)
  })

  it.each(['2026-9-18', '2026-02-30', '2025-02-29', '2026-13-01', '2026-09-18T00:00:00Z', ''])(
    '%s 는 날짜 전용 값이 아니다',
    (value) => {
      expect(isDateOnly(value)).toBe(false)
    },
  )

  it('값을 바꾸지 않고 그대로 돌려준다', () => {
    expect(readDateOnly('2026-09-18')).toBe('2026-09-18')
    expect(readDateOnly(null)).toBeNull()
    expect(readDateOnly('2026-02-30')).toBeNull()
  })

  describe('실행 환경 시간대와 무관하다', () => {
    const original = process.env.TZ

    afterEach(() => {
      if (original === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = original
      }
    })

    it.each(['Pacific/Honolulu', 'Pacific/Kiritimati', 'America/Los_Angeles'])(
      '%s 에서도 결과가 같다',
      (timeZone) => {
        process.env.TZ = timeZone
        expect(readDateOnly('2026-09-18')).toBe('2026-09-18')
        expect(isDateOnly('2026-02-28')).toBe(true)
        expect(formatSeoulDateTime('2026-09-17T15:00:00Z')).toBe('2026-09-18 00:00')
      },
    )
  })
})

describe('서울 자정', () => {
  it('그 날 서울 0시는 UTC 로 전날 15시다', () => {
    expect(seoulMidnightIso('2026-09-18')).toBe('2026-09-17T15:00:00.000Z')
    expect(seoulMidnightIso('2026-01-01')).toBe('2025-12-31T15:00:00.000Z')
  })

  it('형식이 틀리면 null 이다', () => {
    expect(seoulMidnightIso('2026-02-30')).toBeNull()
    expect(seoulMidnightIso('')).toBeNull()
  })

  it('다시 서울 날짜로 읽으면 같은 날이다', () => {
    expect(seoulDateOf(seoulMidnightIso('2026-09-18')!)).toBe('2026-09-18')
  })
})

it('datetime-local 입력값은 한국 시각으로 오간다', () => {
  expect(toSeoulInputValue('2026-09-25T05:30:00Z')).toBe('2026-09-25T14:30')
  expect(fromSeoulInputValue('2026-09-25T14:30')).toBe('2026-09-25T14:30:00+09:00')
  expect(fromSeoulInputValue('')).toBeNull()
  expect(fromSeoulInputValue('2026-09-25')).toBeNull()
})
