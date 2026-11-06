import { ApiError, ERROR_CODES } from '@/shared/api/errors'

/** 코드를 받지 않은 까닭. `SIGNUP_CODE_INVALID` 의 `details` 다 (계약 §4.1.2) */
export type SignupCodeProblem =
  | { reason: 'wrong'; attemptsLeft: number | null }
  | { reason: 'expired' }
  | { reason: 'too_many' }

/** 코드가 틀렸다는 응답이면 까닭을, 다른 실패면 null. 까닭이 없거나 모르는 값이면 횟수를 모르는 `wrong` 이다 */
export function signupCodeProblem(error: unknown): SignupCodeProblem | null {
  if (!(error instanceof ApiError) || error.code !== ERROR_CODES.SIGNUP_CODE_INVALID) return null
  const details = error.details
  if (details?.reason === 'expired') return { reason: 'expired' }
  if (details?.reason === 'too_many') return { reason: 'too_many' }
  const left = details?.attempts_left
  return { reason: 'wrong', attemptsLeft: typeof left === 'number' ? left : null }
}

/** 60초 재발송 제한에 걸렸으면 남은 초를, 다른 실패면 null. 1시간 제한은 코드를 받을 수 없어 여기 들지 않는다 */
export function signupCodeCooldown(error: unknown): number | null {
  if (
    !(error instanceof ApiError) ||
    error.code !== ERROR_CODES.SIGNUP_CODE_RATE_LIMITED ||
    error.details?.reason !== 'cooldown'
  )
    return null
  const retryAfter = error.details.retry_after
  return typeof retryAfter === 'number' ? retryAfter : null
}
