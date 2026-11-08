import type { MeetingStatus } from '@/entities/meeting'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'

/**
 * 지정 제출이 받아들여지지 않은 이유. 화면은 이 값 하나로 문구와 다음 동작을 고른다.
 * - `labelsChanged`: 라벨이 바뀌었다 — 화자 목록을 다시 받는다
 * - `inactiveMembers`: 고른 팀원이 탈퇴했다 — 그 선택만 지우고 다시 받는다
 * - `expired`: 기다리는 사이 회의가 실패로 끝났다(보통 7일 기한 만료). 실제 사유는 다시 받은 상세가 말한다
 * - `alreadyMoved`: 이미 처리가 이어졌거나 끝났다 — 다른 창에서 다른 지정을 냈다
 */
export type SubmitRejection =
  | { kind: 'labelsChanged' }
  | { kind: 'inactiveMembers'; memberIds: string[] }
  | { kind: 'expired' }
  | { kind: 'alreadyMoved'; status: MeetingStatus }
  | { kind: 'forbidden' }
  | { kind: 'notFound' }
  | { kind: 'network' }
  | { kind: 'unknown' }

const MOVED_STATUSES: readonly MeetingStatus[] = ['processing', 'done', 'created', 'recording']

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/**
 * 제출 오류를 이유로 바꾼다. 409 를 모두 만료로 읽지 않는다 — `details.status` 가 `failed` 일 때만이다 (계약 §4.4.1).
 * 400 의 `details` 에 라벨 문제와 팀원 문제가 함께 오면 라벨이 먼저다. 다시 받은 목록으로 고르면 팀원 문제도 다시 드러난다
 */
export function toSubmitRejection(error: unknown): SubmitRejection {
  if (!(error instanceof ApiError)) return { kind: 'unknown' }
  if (error.kind === 'network') return { kind: 'network' }
  if (error.kind !== 'http') return { kind: 'unknown' }
  const details = error.details ?? {}
  switch (error.status) {
    case 400: {
      if (error.code !== ERROR_CODES.INVALID_REQUEST) return { kind: 'unknown' }
      if (strings(details.unknown_labels).length > 0 || strings(details.missing_labels).length > 0)
        return { kind: 'labelsChanged' }
      const memberIds = strings(details.member_ids)
      return memberIds.length > 0 ? { kind: 'inactiveMembers', memberIds } : { kind: 'unknown' }
    }
    case 403:
      return { kind: 'forbidden' }
    case 404:
      return { kind: 'notFound' }
    case 409: {
      if (error.code !== ERROR_CODES.MEETING_NOT_AWAITING_SPEAKERS) return { kind: 'unknown' }
      const status = details.status
      if (status === 'failed') return { kind: 'expired' }
      const moved = MOVED_STATUSES.find((known) => known === status)
      return moved === undefined ? { kind: 'unknown' } : { kind: 'alreadyMoved', status: moved }
    }
    default:
      return { kind: 'unknown' }
  }
}
