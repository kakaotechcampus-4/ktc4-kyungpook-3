import type { MeetingSummary } from '../model/types'

/**
 * 목록에서 정리 중인 회의를 찾는다. 공간마다 한 번에 하나만 정리한다(D-088, D-089) — 여럿이면 가장 최근 것이다.
 * 목록은 서버가 최신순으로 준다 (계약 §4.4).
 */
export function findProcessingMeeting(meetings: readonly MeetingSummary[]): MeetingSummary | null {
  return meetings.find((meeting) => meeting.status === 'processing') ?? null
}
