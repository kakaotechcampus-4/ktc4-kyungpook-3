import { CancelledError } from '@tanstack/react-query'
import { ApiError, CLIENT_ERROR_CODES, ERROR_CODES, createClientError } from './errors'
import { COMMON_MESSAGES, errorMessage, failureNotice } from './errorMessages'

function serverError(code: string, message = 'raw server text', status = 400): ApiError {
  return new ApiError({ code, message, details: null }, status)
}

describe('errorMessage', () => {
  it('서버 코드를 한국어 문구로 바꾼다', () => {
    expect(errorMessage(serverError('TASK_NOT_FOUND', 'Task tk_01 not found', 404))).toBe(
      '태스크를 찾을 수 없어요.',
    )
  })

  it('서버 코드 31개가 모두 전용 문구를 가진다', () => {
    const codes = Object.values(ERROR_CODES)
    expect(codes).toHaveLength(31)
    for (const code of codes) {
      expect(errorMessage(serverError(code))).not.toBe(COMMON_MESSAGES.fallback)
    }
  })

  it('모르는 코드는 서버 기술 문구 대신 공통 문구다', () => {
    const error = serverError('SQLALCHEMY_ERROR', 'psycopg2.OperationalError: refused', 500)
    expect(errorMessage(error)).toBe(COMMON_MESSAGES.fallback)
    expect(errorMessage(error)).not.toContain('psycopg2')
  })

  it('ApiError 가 아닌 오류도 공통 문구다', () => {
    expect(errorMessage(new TypeError('x is undefined'))).toBe(COMMON_MESSAGES.fallback)
    expect(errorMessage('boom')).toBe(COMMON_MESSAGES.fallback)
  })

  it('네트워크 실패와 잘못된 응답은 서로 다른 문구다', () => {
    const network = errorMessage(createClientError(CLIENT_ERROR_CODES.NETWORK_ERROR))
    const invalid = errorMessage(createClientError(CLIENT_ERROR_CODES.INVALID_RESPONSE, 200))
    expect(network).toContain('네트워크')
    expect(invalid).not.toBe(network)
  })
})

describe('failureNotice', () => {
  it('취소는 실패 알림에서 뺀다', () => {
    expect(failureNotice(createClientError(CLIENT_ERROR_CODES.REQUEST_CANCELED))).toBeNull()
    expect(failureNotice(new CancelledError())).toBeNull()
  })

  it('그 밖의 실패는 문구를 준다', () => {
    expect(failureNotice(serverError('FORBIDDEN', 'Forbidden', 403))).toBe('접근 권한이 없어요.')
  })
})
