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

/** 응답을 잃었거나 읽지 못한 업로드가 서버에 받아졌나. `ambiguous` 는 같은 업로드로 보이는 회의가 여럿이라 고를 수 없다 */
export type AcceptedUpload =
  { kind: 'found'; meeting: MeetingSummary } | { kind: 'none' } | { kind: 'ambiguous' }

/**
 * 결과를 모르는 업로드를 목록에서 찾는다. 올리기 전 목록에 없던 직접 올린 회의 중 제목과 회의 시각이 같은 것이다.
 * 상태는 가리지 않는다 — 받아진 뒤 확인하기 전에 화자 지정 대기·완료로 넘어갔을 수 있다 (#348 리뷰).
 * 업로드 차단(`findUploadBlockingMeeting`)과 다르다 — 그쪽은 정리 중인 다른 회의도 찾는다
 */
export function findAcceptedUpload(
  meetings: readonly MeetingSummary[],
  sent: { title: string; startedAt: string },
  knownBefore: ReadonlySet<string>,
): AcceptedUpload {
  const startedAt = Date.parse(sent.startedAt)
  const matches = meetings.filter(
    (meeting) =>
      !knownBefore.has(meeting.id) &&
      meeting.source === 'manual_upload' &&
      meeting.title === sent.title &&
      Date.parse(meeting.startedAt) === startedAt,
  )
  if (matches.length === 0) return { kind: 'none' }
  return matches.length === 1 ? { kind: 'found', meeting: matches[0] } : { kind: 'ambiguous' }
}
