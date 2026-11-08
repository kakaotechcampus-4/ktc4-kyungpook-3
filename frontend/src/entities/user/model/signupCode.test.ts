import { ApiError, CLIENT_ERROR_CODES, createClientError } from '@/shared/api/errors'
import { signupCodeCooldown, signupCodeProblem } from './signupCode'

function apiError(code: string, details: Record<string, unknown> | null): ApiError {
  return new ApiError({ code, message: 'x', details }, 400)
}

describe('signupCodeProblem', () => {
  const invalid = (details: Record<string, unknown> | null) =>
    apiError('SIGNUP_CODE_INVALID', details)

  it('틀린 코드는 남은 횟수를 함께 읽는다', () => {
    expect(signupCodeProblem(invalid({ reason: 'wrong', attempts_left: 3 }))).toEqual({
      reason: 'wrong',
      attemptsLeft: 3,
    })
  })

  it.each(['expired', 'too_many'] as const)('까닭 %s 를 그대로 읽는다', (reason) => {
    expect(signupCodeProblem(invalid({ reason }))).toEqual({ reason })
  })

  it.each([
    ['까닭이 없다', null],
    ['모르는 까닭', { reason: 'x' }],
    ['횟수가 숫자가 아니다', { reason: 'wrong', attempts_left: '3' }],
  ])('%s → 횟수를 모르는 wrong', (_, details) => {
    expect(signupCodeProblem(invalid(details))).toEqual({ reason: 'wrong', attemptsLeft: null })
  })

  it('다른 실패는 코드 문제가 아니다', () => {
    expect(signupCodeProblem(apiError('INVALID_REQUEST', { reason: 'wrong' }))).toBeNull()
    expect(signupCodeProblem(createClientError(CLIENT_ERROR_CODES.NETWORK_ERROR))).toBeNull()
    expect(signupCodeProblem(new Error('boom'))).toBeNull()
  })
})

describe('signupCodeCooldown', () => {
  const limited = (details: Record<string, unknown> | null) =>
    apiError('SIGNUP_CODE_RATE_LIMITED', details)

  it('60초 제한은 남은 초를 돌려준다', () => {
    expect(signupCodeCooldown(limited({ reason: 'cooldown', retry_after: 42 }))).toBe(42)
  })

  it('1시간 제한과 다른 실패는 null 이다', () => {
    expect(signupCodeCooldown(limited({ reason: 'hourly', retry_after: 1800 }))).toBeNull()
    expect(signupCodeCooldown(limited(null))).toBeNull()
    expect(signupCodeCooldown(apiError('INVALID_REQUEST', null))).toBeNull()
  })
})
