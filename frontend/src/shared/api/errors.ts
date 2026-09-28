import { isCancelledError } from '@tanstack/react-query'
import type { ApiErrorDto } from '@/shared/types/api/envelope'

/**
 * - `http`: 서버가 2xx 가 아닌 상태로 응답했다. 봉투가 없으면 code 는 `UNKNOWN_ERROR` 다
 * - `network`: 응답을 받지 못했다
 * - `canceled`: 호출자가 signal 로 취소했다. 실패 알림 대상이 아니다
 * - `invalid_response`: 2xx 인데 봉투를 읽을 수 없다
 */
export type ApiErrorKind = 'http' | 'network' | 'canceled' | 'invalid_response'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly code: string
  readonly status: number
  readonly details: Record<string, unknown> | null

  /** `message` 는 개발자용이다. 화면 문구는 `errorMessage()` 가 code 로 만든다 */
  constructor(error: ApiErrorDto, status: number, kind: ApiErrorKind = 'http') {
    super(error.message)
    this.name = 'ApiError'
    this.kind = kind
    this.code = error.code
    this.status = status
    this.details = error.details
  }
}

export const ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  MEETING_NOT_FOUND: 'MEETING_NOT_FOUND',
  MEETING_ALREADY_ENDED: 'MEETING_ALREADY_ENDED',
  MEETING_NOT_PROCESSING: 'MEETING_NOT_PROCESSING',
  AUDIO_UPLOAD_FAILED: 'AUDIO_UPLOAD_FAILED',
  AUDIO_FORMAT_UNSUPPORTED: 'AUDIO_FORMAT_UNSUPPORTED',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
  EXTRACTION_NOT_FOUND: 'EXTRACTION_NOT_FOUND',
  APPROVAL_NOT_FOUND: 'APPROVAL_NOT_FOUND',
  APPROVAL_ALREADY_RESOLVED: 'APPROVAL_ALREADY_RESOLVED',
  NOTION_WRITE_FAILED: 'NOTION_WRITE_FAILED',
  WORKSPACE_NOT_FOUND: 'WORKSPACE_NOT_FOUND',
  WORKSPACE_MISMATCH: 'WORKSPACE_MISMATCH',
  MEMBER_NOT_FOUND: 'MEMBER_NOT_FOUND',
  MEMBER_ALIAS_NOT_FOUND: 'MEMBER_ALIAS_NOT_FOUND',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  TASK_HISTORY_NOT_FOUND: 'TASK_HISTORY_NOT_FOUND',
  TASK_HISTORY_ALREADY_ROLLED_BACK: 'TASK_HISTORY_ALREADY_ROLLED_BACK',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  WORKSPACE_NAME_DUPLICATED: 'WORKSPACE_NAME_DUPLICATED',
  ONBOARDING_INCOMPLETE: 'ONBOARDING_INCOMPLETE',
  INTEGRATION_NOT_CONNECTED: 'INTEGRATION_NOT_CONNECTED',
  INTEGRATION_REVOKED: 'INTEGRATION_REVOKED',
  MEETING_PROCESSING_IN_PROGRESS: 'MEETING_PROCESSING_IN_PROGRESS',
  AUDIO_TOO_LARGE: 'AUDIO_TOO_LARGE',
  DISCORD_USER_ALREADY_MAPPED: 'DISCORD_USER_ALREADY_MAPPED',
} as const

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/** 서버가 주지 않고 클라이언트가 붙이는 코드. 서버 코드와 섞이지 않게 따로 둔다 */
export const CLIENT_ERROR_CODES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  REQUEST_CANCELED: 'REQUEST_CANCELED',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[keyof typeof CLIENT_ERROR_CODES]

const CLIENT_ERROR_KIND: Record<ClientErrorCode, ApiErrorKind> = {
  NETWORK_ERROR: 'network',
  REQUEST_CANCELED: 'canceled',
  INVALID_RESPONSE: 'invalid_response',
  // 봉투 없는 비-2xx 응답이다. 상태 코드가 있으므로 재시도 판정은 HTTP 규칙을 따른다
  UNKNOWN_ERROR: 'http',
}

/** 응답을 못 받았거나 읽을 수 없을 때 만드는 오류. 상태 코드를 모르면 0 이다 */
export function createClientError(code: ClientErrorCode, status = 0): ApiError {
  return new ApiError({ code, message: code, details: null }, status, CLIENT_ERROR_KIND[code])
}

/** 우리 클라이언트의 취소와 TanStack Query 의 취소를 모두 취소로 본다 */
export function isCanceledError(error: unknown): boolean {
  return isCancelledError(error) || (error instanceof ApiError && error.kind === 'canceled')
}
