import { ApiError, createClientError, CLIENT_ERROR_CODES } from '@/shared/api/errors'
import { resetLinkProblem } from './passwordReset'

function tokenInvalid(details: Record<string, unknown> | null): ApiError {
  return new ApiError({ code: 'PASSWORD_RESET_TOKEN_INVALID', message: 'x', details }, 400)
}

describe('resetLinkProblem', () => {
  it.each(['invalid', 'expired', 'used'] as const)('까닭 %s 를 그대로 읽는다', (reason) => {
    expect(resetLinkProblem(tokenInvalid({ reason }))).toBe(reason)
  })

  it.each([
    ['까닭이 없다', null],
    ['까닭 칸이 비었다', {}],
    ['모르는 까닭', { reason: 'revoked' }],
    ['문자열이 아니다', { reason: 1 }],
  ])('%s → invalid', (_, details) => {
    expect(resetLinkProblem(tokenInvalid(details))).toBe('invalid')
  })

  it('다른 실패는 링크 문제가 아니다', () => {
    const invalidRequest = new ApiError(
      { code: 'INVALID_REQUEST', message: 'x', details: { reason: 'expired' } },
      400,
    )
    expect(resetLinkProblem(invalidRequest)).toBeNull()
    expect(resetLinkProblem(createClientError(CLIENT_ERROR_CODES.NETWORK_ERROR))).toBeNull()
    expect(resetLinkProblem(new Error('boom'))).toBeNull()
  })
})
