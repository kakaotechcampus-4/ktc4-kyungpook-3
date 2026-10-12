import type { Meeting, TrackedMeeting } from '@/entities/meeting'
import { ApiError } from '@/shared/api/errors'

/** 상세 polling 간격. 정리 중일 때만 돈다 (계획 §3 처리 추적) */
export const PROCESSING_POLL_INTERVAL_MS = 3_000

/**
 * 추적 중인 회의의 지금 판정.
 * - `processing`: 아직 정리 중이거나 아직 모른다(첫 응답 전·일시적 조회 실패) — 계속 지켜본다
 * - `done`·`failed`: 정리가 끝났다
 * - `lost`: 볼 수 없게 됐다(403·404, 다른 공간의 회의) — 알림 없이 그만 본다
 */
export type TrackerOutcome = 'processing' | 'done' | 'failed' | 'lost'

/** 접근 권한을 잃었다. 다시 물어도 같다 */
export function isAccessLost(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'http' && [403, 404].includes(error.status)
}

/**
 * 상세 조회 결과로 판정한다. 네트워크 오류 같은 일시적 실패는 정리 실패가 아니다 —
 * 마지막으로 받은 상태(없으면 정리 중)를 그대로 쓰고 다음 polling·연결 복귀를 기다린다 (U4-8).
 * 401 은 여기 오기 전에 세션 만료 처리가 맡는다.
 */
export function trackerOutcome(
  meeting: TrackedMeeting,
  data: Meeting | undefined,
  error: unknown,
): TrackerOutcome {
  if (isAccessLost(error)) return 'lost'
  if (data === undefined) return 'processing'
  // 상세 경로에는 공간이 없다(계약 §2.3). 다른 공간의 회의면 이 공간에서 지켜볼 것이 아니다
  if (data.workspaceId !== meeting.workspaceId) return 'lost'
  switch (data.status) {
    case 'processing':
      return 'processing'
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    default:
      // created·recording — 정리가 시작되지 않은 회의는 이 추적기의 대상이 아니다
      return 'lost'
  }
}

/** 다음 polling 까지의 간격. 끝났거나 볼 수 없으면 멈춘다 */
export function pollInterval(
  meeting: TrackedMeeting,
  data: Meeting | undefined,
  error: unknown,
): number | false {
  return trackerOutcome(meeting, data, error) === 'processing' ? PROCESSING_POLL_INTERVAL_MS : false
}
