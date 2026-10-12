import type { MeetingSummary } from '@/entities/meeting'
import { detailMeta, formatClock, formatDue, formatMinutesLength, listMeta } from './format'

const summary: MeetingSummary = {
  id: 'mt_09',
  title: '3주차 정기회의',
  status: 'done',
  source: 'discord',
  startedAt: '2026-09-15T05:00:00Z',
  durationMs: 2_730_000,
  attendeeCount: 4,
  processedAt: null,
}

describe('회의록 표시 형식', () => {
  it('회의 안 시각은 mm:ss, 한 시간이 넘으면 h:mm:ss 다', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(125_000)).toBe('02:05')
    expect(formatClock(2_730_000)).toBe('45:30')
    expect(formatClock(3_725_000)).toBe('1:02:05')
  })

  it('목록 길이는 분 단위이고 모르면(0·null) 쓰지 않는다', () => {
    expect(formatMinutesLength(2_730_000)).toBe('46분')
    expect(formatMinutesLength(20_000)).toBe('1분')
    expect(formatMinutesLength(0)).toBeNull()
    expect(formatMinutesLength(null)).toBeNull()
  })

  it('목록 메타는 서울 날짜·시각, 길이, 인원이다 — 모르는 값은 빠진다', () => {
    expect(listMeta(summary)).toBe('09/15 14:00 · 46분 · 4명')
    expect(listMeta({ ...summary, durationMs: 0, attendeeCount: 0 })).toBe('09/15 14:00')
  })

  it('회의록 머리 메타는 서울 날짜·시각과 길이다', () => {
    expect(detailMeta('2026-09-15T05:00:00Z', 2_730_000)).toBe('2026-09-15 14:00 · 45:30')
    expect(detailMeta('2026-09-15T05:00:00Z', 0)).toBe('2026-09-15 14:00')
  })

  it('마감일은 시간대 변환 없이 월/일이다', () => {
    expect(formatDue('2026-09-20')).toBe('9/20')
    expect(formatDue('2026-12-01')).toBe('12/1')
    expect(formatDue(null)).toBeNull()
    expect(formatDue('다음 주')).toBeNull()
  })
})
