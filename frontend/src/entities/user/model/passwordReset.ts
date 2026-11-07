import { ApiError, ERROR_CODES } from '@/shared/api/errors'

/** 재설정 링크를 쓸 수 없는 까닭. `PASSWORD_RESET_TOKEN_INVALID` 의 `details.reason` 이다 (계약 §4.1.1) */
export type ResetLinkProblem = 'invalid' | 'expired' | 'used'

const RESET_LINK_PROBLEMS: readonly ResetLinkProblem[] = ['invalid', 'expired', 'used']

/**
 * 링크를 쓸 수 없다는 응답이면 그 까닭을, 다른 실패면 null 을 돌려준다.
 * 까닭이 없거나 모르는 값이면 `invalid` 다 — 어느 경우든 새 링크를 받아야 한다.
 */
export function resetLinkProblem(error: unknown): ResetLinkProblem | null {
  if (!(error instanceof ApiError) || error.code !== ERROR_CODES.PASSWORD_RESET_TOKEN_INVALID)
    return null
  const reason = error.details?.reason
  return RESET_LINK_PROBLEMS.find((problem) => problem === reason) ?? 'invalid'
}
