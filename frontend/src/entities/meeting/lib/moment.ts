import { formatSeoulMonthDayTime } from '@/shared/lib/date'
import { meetingSourceTraits } from '../model/sourceTraits'
import type { MeetingTimeAxis } from '../model/sourceTraits'
import type { MeetingSourceValue, MeetingSummary } from '../model/types'

/** 회의 안 시각·길이. 1시간 미만은 `mm:ss`, 넘으면 `h:mm:ss` — Meetings 캔버스의 `12:40` · `52:14` 모양이다 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${mmss}` : mmss
}

/** 회의 시작 시각에 오프셋을 더한 실제 시각(ISO). 시작 시각을 읽지 못하면 null */
export function offsetInstant(startedAt: string, offsetMs: number): string | null {
  const start = Date.parse(startedAt)
  return Number.isNaN(start) ? null : new Date(start + offsetMs).toISOString()
}

const MOMENT: Record<MeetingTimeAxis, (startedAt: string, atMs: number) => string> = {
  recording: (_startedAt, atMs) => formatClock(atMs),
  wall_clock: (startedAt, atMs) => {
    const instant = offsetInstant(startedAt, atMs)
    return instant === null ? '' : formatSeoulMonthDayTime(instant)
  },
  unknown: () => '',
}

/**
 * 전사문 줄·근거의 시각. 녹음 회의는 녹음 안 위치 `12:40`, 채팅 회의는 메시지를 쓴 서울 시각 `09/15 18:40` 이다.
 * 모르는 출처는 빈 글자다
 */
export function formatMoment(source: MeetingSourceValue, startedAt: string, atMs: number): string {
  return MOMENT[meetingSourceTraits(source).timeAxis](startedAt, atMs)
}

/**
 * 승인 근거의 시각. 승인에는 회의 출처가 없어 `meetingId` 로 찾은 회의가 읽는 방식을 정한다 (#397).
 * 회의를 찾지 못하면 시각을 모르는 것으로 null 이다 — 녹음 위치로 읽으면 채팅 회의가 `26:40:00` 처럼 보인다
 */
export function evidenceMoment(
  meeting: Pick<MeetingSummary, 'source' | 'startedAt'> | undefined,
  atMs: number | null,
): string | null {
  if (meeting === undefined || atMs === null) return null
  const moment = formatMoment(meeting.source, meeting.startedAt, atMs)
  return moment === '' ? null : moment
}
