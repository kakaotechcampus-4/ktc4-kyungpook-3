import type { MeetingSummary } from '../model/types'
import { meetingFailure } from './meetingFailure'

/**
 * 완료·진행 중·기한 만료 이력을 회의 날짜 최신순으로 나눈다.
 * 일반 실패는 기존 D-093대로 숨기고, 수동 업로드의 화자 지정 만료(#256)·정리 시작 만료(#598)만 남긴다.
 */
export interface MinutesList {
  minutes: MeetingSummary[]
  /** 정리 중(`processing`)·화자 지정 대기(`awaiting_speakers`)·회의 중(`created`·`recording`). 회의록이 아니라 상태 항목으로 보인다 */
  inProgress: MeetingSummary[]
  expired: MeetingSummary[]
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
    expired: sorted.filter(
      ({ status, source, failedStage }) =>
        status === 'failed' &&
        source === 'manual_upload' &&
        meetingFailure(failedStage).expiredLabel !== null,
    ),
  }
}

/** 기본 진입에서 고를 회의 — 가장 최근에 열린 정리 끝난 회의. 없으면 null (D-106, U5-1) */
export function latestMinutesId(meetings: readonly MeetingSummary[]): string | null {
  return toMinutesList(meetings).minutes[0]?.id ?? null
}
