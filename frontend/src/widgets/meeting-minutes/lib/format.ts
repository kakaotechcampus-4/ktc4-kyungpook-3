import type { MeetingSource, MeetingSummary } from '@/entities/meeting'
import { formatSeoulDateTime, readDateOnly } from '@/shared/lib/date'

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

/** 목록 한 줄의 메타 — `09/15 14:00 · 46분 · 4명` (Meetings 캔버스). 서울 시각이다 (D-144) */
export function listMeta(meeting: MeetingSummary): string {
  const dateTime = formatSeoulDateTime(meeting.startedAt)
  // `YYYY-MM-DD HH:mm` 에서 연도를 뗀다
  const shortDateTime = dateTime === '' ? null : dateTime.slice(5).replace('-', '/')
  return [
    shortDateTime,
    formatMinutesLength(meeting.durationMs),
    meeting.attendeeCount > 0 ? `${meeting.attendeeCount}명` : null,
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

/** 회의록 머리의 메타 — `2026-09-15 14:00 · 45:30`. 길이를 모르면 날짜만이다 */
export function detailMeta(startedAt: string, durationMs: number): string {
  return [formatSeoulDateTime(startedAt), durationMs > 0 ? formatClock(durationMs) : null]
    .filter((part) => part !== null && part !== '')
    .join(' · ')
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
}
