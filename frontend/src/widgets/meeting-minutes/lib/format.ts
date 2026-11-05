import { MEETING_SOURCE_TRAITS } from '@/entities/meeting'
import type { MeetingSource, MeetingSummary, MeetingTimeAxis } from '@/entities/meeting'
import {
  formatSeoulDateTime,
  formatSeoulMonthDayTime,
  readDateOnly,
  seoulDateOf,
} from '@/shared/lib/date'

/** 회의 안 시각·길이. 1시간 미만은 `mm:ss`, 넘으면 `h:mm:ss` — Meetings 캔버스의 `12:40` · `52:14` 모양이다 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${mmss}` : mmss
}

/** 목록 한 줄의 길이 — `52분`. 길이를 모르면(0·null) 쓰지 않는다. 실 API 는 오디오가 없으면 0 을 준다 (계약 §4.4) */
export function formatMinutesLength(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null
  return `${Math.max(1, Math.round(ms / 60_000))}분`
}

/**
 * 목록 한 줄의 메타 — `09/15 14:00 · 46분 · 4명` (Meetings 캔버스). 서울 시각이다 (D-144).
 * 채팅 회의는 길이가 녹음 길이가 아니라 기간이라 빼고 `09/15 09:12 · 4명` 이다
 */
export function listMeta(meeting: MeetingSummary): string {
  const shortDateTime = formatSeoulMonthDayTime(meeting.startedAt)
  const length =
    MEETING_SOURCE_TRAITS[meeting.source].timeAxis === 'recording'
      ? formatMinutesLength(meeting.durationMs)
      : null
  return [
    shortDateTime === '' ? null : shortDateTime,
    length,
    meeting.attendeeCount > 0 ? `${meeting.attendeeCount}명` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

function offsetInstant(startedAt: string, offsetMs: number): string | null {
  const start = Date.parse(startedAt)
  return Number.isNaN(start) ? null : new Date(start + offsetMs).toISOString()
}

/** 첫 메시지부터 마지막 메시지까지 — `2026-09-15 09:12 ~ 09/16 08:40`, 같은 날 끝나면 `2026-09-15 09:12 ~ 18:40` */
function chatRange(startedAt: string, durationMs: number): string {
  const start = formatSeoulDateTime(startedAt)
  const end = durationMs > 0 ? offsetInstant(startedAt, durationMs) : null
  if (start === '' || end === null) return start
  return seoulDateOf(end) === seoulDateOf(startedAt)
    ? `${start} ~ ${formatSeoulDateTime(end).slice(11)}`
    : `${start} ~ ${formatSeoulMonthDayTime(end)}`
}

const DETAIL_META: Record<MeetingTimeAxis, (startedAt: string, durationMs: number) => string> = {
  recording: (startedAt, durationMs) =>
    [formatSeoulDateTime(startedAt), durationMs > 0 ? formatClock(durationMs) : null]
      .filter((part) => part !== null && part !== '')
      .join(' · '),
  wall_clock: chatRange,
}

/** 회의록 머리의 메타 — 녹음 회의는 `2026-09-15 14:00 · 45:30`, 채팅 회의는 서울 시각 범위다. 길이를 모르면 시작 시각만이다 */
export function detailMeta(source: MeetingSource, startedAt: string, durationMs: number): string {
  return DETAIL_META[MEETING_SOURCE_TRAITS[source].timeAxis](startedAt, durationMs)
}

const MOMENT: Record<MeetingTimeAxis, (startedAt: string, atMs: number) => string> = {
  recording: (_startedAt, atMs) => formatClock(atMs),
  wall_clock: (startedAt, atMs) => {
    const instant = offsetInstant(startedAt, atMs)
    return instant === null ? '' : formatSeoulMonthDayTime(instant)
  },
}

/** 전사문 줄·근거의 시각. 녹음 회의는 녹음 안 위치 `12:40`, 채팅 회의는 메시지를 쓴 서울 시각 `09/15 18:40` 이다 */
export function formatMoment(source: MeetingSource, startedAt: string, atMs: number): string {
  return MOMENT[MEETING_SOURCE_TRAITS[source].timeAxis](startedAt, atMs)
}

/** 마감일 — `9/20`. 날짜 전용 값이라 시간대를 바꾸지 않는다 (D-144). 형식이 틀리면 null */
export function formatDue(date: string | null): string | null {
  const value = readDateOnly(date)
  if (value === null) return null
  const [, month, day] = value.split('-')
  return `${Number(month)}/${Number(day)}`
}

/** 출처 표시. Discord 회의는 봇이 모은 것이고 업로드 관련 행동이 없다 (U5-9, D-157) */
export const SOURCE_LABEL: Record<MeetingSource, string> = {
  discord: 'Discord 자동 수집',
  manual_upload: '직접 올린 녹음',
  chat: 'Discord 채팅',
}

/** 목록 행 제목 옆 배지. 채팅 회의는 음성 회의와 같은 목록에 섞이므로 구분해 보인다 (#379) */
export const SOURCE_BADGE: Record<MeetingSource, string | null> = {
  discord: null,
  manual_upload: null,
  chat: '채팅',
}
