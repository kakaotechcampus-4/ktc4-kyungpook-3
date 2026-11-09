import { isAccessLost } from '@/entities/meeting'
import type { Meeting } from '@/entities/meeting'
import { isInvalidResponse, isWorkspaceMismatch } from '@/shared/api/errors'

/** 상세 polling 간격. 정리 중일 때만 돈다 (계획 §3 처리 추적) */
export const PROCESSING_POLL_INTERVAL_MS = 3_000

export const AWAITING_SPEAKERS_POLL_INTERVAL_MS = 30_000

/**
 * 추적 중인 회의의 지금 판정.
 * - `processing`: 아직 정리 중이거나 아직 모른다(첫 응답 전·일시적 조회 실패) — 계속 지켜본다
 * - `awaiting_speakers`: 업로드 회의가 PM 의 화자 지정을 기다린다. 정상 진행이다 — 지켜보며 지정 화면으로 안내한다 (#256)
 * - `done`·`failed`: 정리가 끝났다
 * - `lost`: 볼 수 없게 됐다(403·404, 받아 둔 상태 없이 다른 공간의 회의라는 답) — 알림 없이 그만 본다
 * - `invalid`: 상세 응답을 읽지 못했다(`INVALID_RESPONSE`). 다시 물어도 같은 답이라 자동으로 묻지 않고 사용자의 다시 시도를
 *   기다린다. 정리 실패·완료가 아니라 끝내지 않는다. 받아 둔 상세가 있어도 그 상태로 보지 않는다 (#348)
 */
export type TrackerOutcome =
  'processing' | 'awaiting_speakers' | 'done' | 'failed' | 'lost' | 'invalid'

/**
 * 상세 조회 결과로 판정한다. 네트워크 오류 같은 일시적 실패는 정리 실패가 아니다 —
 * 마지막으로 받은 상태(없으면 정리 중)를 그대로 쓰고 다음 polling·연결 복귀를 기다린다 (U4-8).
 * 401 은 여기 오기 전에 세션 만료 처리가 맡는다.
 * 다른 공간의 회의라는 답(`WORKSPACE_MISMATCH`)은 캐시를 덮지 않는다. 받아 둔 상태가 없을 때만 이 공간에서 지켜볼 회의가
 * 아니라고 보고, 있으면 다른 일시적 실패처럼 그 상태로 계속 지켜본다 (#349).
 */
export function trackerOutcome(data: Meeting | undefined, error: unknown): TrackerOutcome {
  if (isAccessLost(error)) return 'lost'
  if (isInvalidResponse(error)) return 'invalid'
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
  invalid: false,
}

/** 다음 polling 까지의 간격. 끝났거나 볼 수 없거나 응답을 읽지 못했으면 멈춘다 */
export function pollInterval(data: Meeting | undefined, error: unknown): number | false {
  return POLL_INTERVALS[trackerOutcome(data, error)]
}

/**
 * 창 포커스·연결 복귀 때 다시 물을까. 끊긴 사이에 끝났을 수 있어 평소에는 최신 시간과 상관없이 묻는다(`always`).
 * 응답을 읽지 못한 상세는 다시 물어도 같아 묻지 않는다 — 사용자의 다시 시도만 기다린다 (#348)
 */
export function refetchOnReturn({ state }: { state: { error: unknown } }): boolean | 'always' {
  return isInvalidResponse(state.error) ? false : 'always'
}
