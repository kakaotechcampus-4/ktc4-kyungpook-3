import { formatSeoulDateTime, isDateOnly, readDateOnly, seoulDateOf } from './format'

describe('timestamp 는 한국 시간으로 보여 준다', () => {
  it('UTC 자정 전후에서 서울 날짜 경계를 넘는다', () => {
    expect(formatSeoulDateTime('2026-09-17T15:00:00Z')).toBe('2026-09-18 00:00')
    expect(formatSeoulDateTime('2026-09-17T14:59:59Z')).toBe('2026-09-17 23:59')
  })

  it('오프셋이 붙은 값도 서울 시각이다', () => {
    expect(formatSeoulDateTime('2026-09-18T09:00:00+09:00')).toBe('2026-09-18 09:00')
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
