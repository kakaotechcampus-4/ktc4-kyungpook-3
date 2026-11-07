import { evidenceMoment, formatClock, formatMoment } from './moment'

const chat = { source: 'chat', startedAt: '2026-09-11T00:12:00Z' } as const
const recording = { source: 'discord', startedAt: '2026-09-15T05:00:00Z' } as const

describe('회의 안 시각', () => {
  it('녹음 위치는 mm:ss, 한 시간이 넘으면 h:mm:ss 다', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(125_000)).toBe('02:05')
    expect(formatClock(2_730_000)).toBe('45:30')
    expect(formatClock(3_725_000)).toBe('1:02:05')
  })

  it('채팅 회의는 메시지를 쓴 서울 시각이고, 녹음 회의는 녹음 안 위치 그대로다 (#379)', () => {
    expect(formatMoment('chat', '2026-09-15T00:12:00Z', 0)).toBe('09/15 09:12')
    // 23:40Z 는 UTC 로는 같은 날이지만 서울로는 다음 날 08:40 이다
    expect(formatMoment('chat', '2026-09-15T00:12:00Z', 84_480_000)).toBe('09/16 08:40')
    expect(formatMoment('discord', '2026-09-15T00:12:00Z', 125_000)).toBe('02:05')
    expect(formatMoment('manual_upload', '2026-09-15T00:12:00Z', 3_725_000)).toBe('1:02:05')
  })
})

describe('승인 근거 시각 (#397)', () => {
  it('채팅 회의의 근거는 실제 작성 시각이다', () => {
    expect(evidenceMoment(chat, 34_080_000)).toBe('09/11 18:40')
  })

  it('녹음 회의의 근거는 녹음 안 위치다', () => {
    expect(evidenceMoment(recording, 125_000)).toBe('02:05')
    expect(evidenceMoment({ ...recording, source: 'manual_upload' }, 34_080_000)).toBe('9:28:00')
  })

  it('회의를 찾지 못했거나 근거 시각이 없으면 시각을 모른다', () => {
    expect(evidenceMoment(undefined, 34_080_000)).toBeNull()
    expect(evidenceMoment(chat, null)).toBeNull()
  })

  it('채팅 회의의 시작 시각을 읽지 못하면 녹음 위치로 바꿔 읽지 않고 모른다고 한다', () => {
    expect(evidenceMoment({ source: 'chat', startedAt: '' }, 34_080_000)).toBeNull()
  })
})
