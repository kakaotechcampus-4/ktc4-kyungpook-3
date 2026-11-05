import type { Meeting } from '@/entities/meeting'
import { ApiError, isWorkspaceMismatch } from '@/shared/api/errors'

/** 상세 polling 간격. 정리 중일 때만 돈다 (계획 §3 처리 추적) */
export const PROCESSING_POLL_INTERVAL_MS = 3_000

export const AWAITING_SPEAKERS_POLL_INTERVAL_MS = 30_000

/**
 * 추적 중인 회의의 지금 판정.
 * - `processing`: 아직 정리 중이거나 아직 모른다(첫 응답 전·일시적 조회 실패) — 계속 지켜본다
 * - `awaiting_speakers`: 업로드 회의가 PM 의 화자 지정을 기다린다. 정상 진행이다 — 지켜보며 지정 화면으로 안내한다 (#256)
 * - `done`·`failed`: 정리가 끝났다
 * - `lost`: 볼 수 없게 됐다(403·404, 받아 둔 상태 없이 다른 공간의 회의라는 답) — 알림 없이 그만 본다
 */
export type TrackerOutcome = 'processing' | 'awaiting_speakers' | 'done' | 'failed' | 'lost'

/** 접근 권한을 잃었다. 다시 물어도 같다 */
export function isAccessLost(error: unknown): boolean {
  return error instanceof ApiError && error.kind === 'http' && [403, 404].includes(error.status)
}

export function isMeetingUnavailable(error: unknown): boolean {
  return isAccessLost(error) || isWorkspaceMismatch(error)
}

/**
 * 상세 조회 결과로 판정한다. 네트워크 오류 같은 일시적 실패는 정리 실패가 아니다 —
 * 마지막으로 받은 상태(없으면 정리 중)를 그대로 쓰고 다음 polling·연결 복귀를 기다린다 (U4-8).
 * 401 은 여기 오기 전에 세션 만료 처리가 맡는다.
 * 다른 공간의 회의라는 답(`WORKSPACE_MISMATCH`)은 캐시를 덮지 않는다. 받아 둔 상태가 없을 때만 이 공간에서 지켜볼 회의가
 * 아니라고 보고, 있으면 다른 일시적 실패처럼 그 상태로 계속 지켜본다 (#349).
 */
export function trackerOutcome(data: Meeting | undefined, error: unknown): TrackerOutcome {
  if (isAccessLost(error)) return 'lost'
  if (data === undefined) return isWorkspaceMismatch(error) ? 'lost' : 'processing'
  switch (data.status) {
    case 'processing':
      return 'processing'
    case 'awaiting_speakers':
      return 'awaiting_speakers'
    case 'done':
      return 'done'
    case 'failed':
      return 'failed'
    default:
      // created·recording — 정리가 시작되지 않은 회의는 이 추적기의 대상이 아니다
      return 'lost'
  }
}

const POLL_INTERVALS: Record<TrackerOutcome, number | false> = {
  processing: PROCESSING_POLL_INTERVAL_MS,
  awaiting_speakers: AWAITING_SPEAKERS_POLL_INTERVAL_MS,
  done: false,
  failed: false,
  lost: false,
}

/** 다음 polling 까지의 간격. 끝났거나 볼 수 없으면 멈춘다 */
export function pollInterval(data: Meeting | undefined, error: unknown): number | false {
  return POLL_INTERVALS[trackerOutcome(data, error)]
}
