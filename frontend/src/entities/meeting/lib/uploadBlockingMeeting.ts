import type { MeetingSummary } from '../model/types'

/**
 * 업로드를 막는 정리 중 회의를 찾는다. 공간마다 한 번에 하나만 정리한다(D-088, D-089) — 여럿이면 가장 최근 것이다.
 * 채팅 회의는 정리 중이어도 업로드를 막지 않는다. 서버도 409 를 주지 않는다 (계약 §4.4, #450).
 * 목록은 서버가 최신순으로 준다 (계약 §4.4).
 */
export function findUploadBlockingMeeting(
  meetings: readonly MeetingSummary[],
): MeetingSummary | null {
  return (
    meetings.find((meeting) => meeting.status === 'processing' && meeting.source !== 'chat') ?? null
  )
}
