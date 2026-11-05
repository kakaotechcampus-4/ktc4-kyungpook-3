import type { MeetingSummary } from '@/entities/meeting'
import {
  detailMeta,
  formatClock,
  formatDue,
  formatMinutesLength,
  formatMoment,
  listMeta,
  SOURCE_LABEL,
} from './format'

const summary: MeetingSummary = {
  id: 'mt_09',
  title: '3주차 정기회의',
  status: 'done',
  source: 'discord',
  startedAt: '2026-09-15T05:00:00Z',
  durationMs: 2_730_000,
  attendeeCount: 4,
  processedAt: null,
  failedStage: null,
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
    expect(detailMeta('discord', '2026-09-15T05:00:00Z', 2_730_000)).toBe(
      '2026-09-15 14:00 · 45:30',
    )
    expect(detailMeta('manual_upload', '2026-09-15T05:00:00Z', 0)).toBe('2026-09-15 14:00')
  })

  describe('채팅 회의 (#379)', () => {
    const chat: MeetingSummary = {
      ...summary,
      source: 'chat',
      startedAt: '2026-09-15T00:12:00Z',
      durationMs: 84_480_000,
    }

    it('목록 메타는 기간을 빼고 시작 시각과 인원만이다', () => {
      expect(listMeta(chat)).toBe('09/15 09:12 · 4명')
    })

    it('머리 메타는 첫 메시지부터 마지막 메시지까지의 서울 시각 범위다', () => {
      // 23:40Z 는 UTC 로는 같은 날이지만 서울로는 다음 날 08:40 이다
      expect(detailMeta('chat', chat.startedAt, 84_480_000)).toBe('2026-09-15 09:12 ~ 09/16 08:40')
      expect(detailMeta('chat', chat.startedAt, 34_080_000)).toBe('2026-09-15 09:12 ~ 18:40')
    })

    it('길이를 모르면 머리 메타는 시작 시각만이다', () => {
      expect(detailMeta('chat', chat.startedAt, 0)).toBe('2026-09-15 09:12')
    })

    it('전사문·근거 시각은 메시지를 쓴 서울 시각이고, 녹음 회의는 녹음 안 위치 그대로다', () => {
      expect(formatMoment('chat', chat.startedAt, 0)).toBe('09/15 09:12')
      expect(formatMoment('chat', chat.startedAt, 84_480_000)).toBe('09/16 08:40')
      expect(formatMoment('discord', chat.startedAt, 125_000)).toBe('02:05')
      expect(formatMoment('manual_upload', chat.startedAt, 3_725_000)).toBe('1:02:05')
    })

    it('출처 칩은 Discord 채팅이다', () => {
      expect(SOURCE_LABEL.chat).toBe('Discord 채팅')
    })
  })

  it('마감일은 시간대 변환 없이 월/일이다', () => {
    expect(formatDue('2026-09-20')).toBe('9/20')
    expect(formatDue('2026-12-01')).toBe('12/1')
    expect(formatDue(null)).toBeNull()
    expect(formatDue('다음 주')).toBeNull()
  })
})
