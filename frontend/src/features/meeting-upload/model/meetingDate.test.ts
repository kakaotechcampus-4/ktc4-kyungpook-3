import { fileSeoulDate, toStartedAt } from './meetingDate'

const at = (iso: string) => Date.parse(iso)

describe('회의 날짜 기본값과 보낼 시각 (U3-5)', () => {
  it('날짜 칸은 파일 수정 시각의 서울 날짜다', () => {
    expect(fileSeoulDate(at('2026-09-09T05:30:00Z'))).toBe('2026-09-09')
  })

  it('자정 경계 — UTC 15:00 은 서울로 다음 날 0시, 14:59:59 는 같은 날이다', () => {
    expect(fileSeoulDate(at('2026-09-08T15:00:00Z'))).toBe('2026-09-09')
    expect(fileSeoulDate(at('2026-09-08T14:59:59.999Z'))).toBe('2026-09-08')
  })

  it('날짜를 고치지 않으면 파일의 원래 시각을 그대로 보낸다', () => {
    const lastModified = at('2026-09-09T05:30:12.345Z')
    expect(toStartedAt(lastModified, '2026-09-09')).toBe('2026-09-09T05:30:12.345Z')
  })

  it('자정 직후 파일도 고치지 않으면 원래 시각이다 — UTC 날짜가 달라도 서울 날짜로 비교한다', () => {
    const lastModified = at('2026-09-08T15:00:01Z')
    expect(toStartedAt(lastModified, '2026-09-09')).toBe('2026-09-08T15:00:01.000Z')
  })

  it('날짜를 고치면 고른 날 서울 자정의 ISO 시각을 보낸다', () => {
    const lastModified = at('2026-09-09T05:30:00Z')
    expect(toStartedAt(lastModified, '2026-09-11')).toBe('2026-09-10T15:00:00.000Z')
  })

  it('고친 날이 UTC 기준 파일 날짜와 같아도 서울 날짜가 다르면 고친 것이다', () => {
    // 서울 2026-09-09 00:30 파일 — UTC 로는 9월 8일이다. 8일로 고치면 8일 서울 자정이다
    const lastModified = at('2026-09-08T15:30:00Z')
    expect(toStartedAt(lastModified, '2026-09-08')).toBe('2026-09-07T15:00:00.000Z')
  })

  describe('실행 환경 시간대와 무관하다', () => {
    const original = process.env.TZ
    afterEach(() => {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    })

    it.each(['America/Los_Angeles', 'Pacific/Kiritimati'])('%s', (timeZone) => {
      process.env.TZ = timeZone
      const lastModified = at('2026-09-08T15:00:00Z')
      expect(fileSeoulDate(lastModified)).toBe('2026-09-09')
      expect(toStartedAt(lastModified, '2026-09-10')).toBe('2026-09-09T15:00:00.000Z')
    })
  })
})
