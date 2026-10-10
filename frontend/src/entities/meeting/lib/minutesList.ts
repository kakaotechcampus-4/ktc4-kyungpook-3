import type { MeetingSummary } from '../model/types'

/**
 * 회의록 목록 한 벌. 정리가 끝난 회의(`minutes`)와 아직 회의록이 없는 회의(`inProgress`)로 나눈다 (U5-1, U5-2).
 * 둘 다 회의 날짜 최신순이다 (D-106). 실패 회의는 어느 쪽에도 없다 — 서버가 빼고(D-093), 남아 있어도 여기서 뺀다.
 */
export interface MinutesList {
  minutes: MeetingSummary[]
  /** 정리 중(`processing`)·회의 중(`created`·`recording`). 회의록이 아니라 상태 항목으로 보인다 */
  inProgress: MeetingSummary[]
}

function startedAtOf(meeting: MeetingSummary): number {
  const time = Date.parse(meeting.startedAt)
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time
}

/** 서버가 `started_at` 내림차순으로 주지만(계약 §4.4) 화면이 기대는 순서라 한 번 더 맞춘다. 같은 시각이면 받은 순서다 */
function byStartedAtDesc(meetings: readonly MeetingSummary[]): MeetingSummary[] {
  return [...meetings].sort((a, b) => startedAtOf(b) - startedAtOf(a))
}

export function toMinutesList(meetings: readonly MeetingSummary[]): MinutesList {
  const sorted = byStartedAtDesc(meetings)
  return {
    minutes: sorted.filter(({ status }) => status === 'done'),
    inProgress: sorted.filter(({ status }) => status !== 'done' && status !== 'failed'),
  }
}

/** 기본 진입에서 고를 회의 — 가장 최근에 열린 정리 끝난 회의. 없으면 null (D-106, U5-1) */
export function latestMinutesId(meetings: readonly MeetingSummary[]): string | null {
  return toMinutesList(meetings).minutes[0]?.id ?? null
}
