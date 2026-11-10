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
  CONSENT_VERSION_MISMATCH: 'CONSENT_VERSION_MISMATCH',
  CONSENT_ACCOUNT_CHANGED: 'CONSENT_ACCOUNT_CHANGED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  MEETING_NOT_FOUND: 'MEETING_NOT_FOUND',
  MEETING_ALREADY_ENDED: 'MEETING_ALREADY_ENDED',
  MEETING_NOT_PROCESSING: 'MEETING_NOT_PROCESSING',
  MEETING_NOT_AWAITING_SPEAKERS: 'MEETING_NOT_AWAITING_SPEAKERS',
  AUDIO_UPLOAD_FAILED: 'AUDIO_UPLOAD_FAILED',
  AUDIO_FORMAT_UNSUPPORTED: 'AUDIO_FORMAT_UNSUPPORTED',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  EXTRACTION_FAILED: 'EXTRACTION_FAILED',
  EXTRACTION_NOT_FOUND: 'EXTRACTION_NOT_FOUND',
  EXTRACTION_ITEM_NOT_FOUND: 'EXTRACTION_ITEM_NOT_FOUND',
  AUTO_TASK_NOT_REVERTIBLE: 'AUTO_TASK_NOT_REVERTIBLE',
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
  TOPIC_NOT_FOUND: 'TOPIC_NOT_FOUND',
  TOPIC_NAME_TAKEN: 'TOPIC_NAME_TAKEN',
  DECISION_NOT_FOUND: 'DECISION_NOT_FOUND',
  SUMMARY_NOT_FOUND: 'SUMMARY_NOT_FOUND',
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
  MEETING_FAILED: 'MEETING_FAILED',
  APPROVAL_CONFLICT: 'APPROVAL_CONFLICT',
  APPROVAL_CHANGED: 'APPROVAL_CHANGED',
  LAST_PM_REQUIRED: 'LAST_PM_REQUIRED',
  EMBEDDING_UNAVAILABLE: 'EMBEDDING_UNAVAILABLE',
  DISCORD_API_FAILED: 'DISCORD_API_FAILED',
  DISCORD_CHANNEL_NOT_FOUND: 'DISCORD_CHANNEL_NOT_FOUND',
  DISCORD_CHANNEL_NOT_ACCESSIBLE: 'DISCORD_CHANNEL_NOT_ACCESSIBLE',
  NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
  AUTO_BLOCK_NOT_FOUND: 'AUTO_BLOCK_NOT_FOUND',
  REPLY_JUDGMENT_NOT_FOUND: 'REPLY_JUDGMENT_NOT_FOUND',
  REPLY_ATTRIBUTION_NOT_NEEDED: 'REPLY_ATTRIBUTION_NOT_NEEDED',
  REPLY_CHANGE_NOT_UNDOABLE: 'REPLY_CHANGE_NOT_UNDOABLE',
  INVITATION_NOT_FOUND: 'INVITATION_NOT_FOUND',
  INVITATION_NOT_PENDING: 'INVITATION_NOT_PENDING',
  INVITATION_NOT_ACCEPTED: 'INVITATION_NOT_ACCEPTED',
  MEMBER_ALREADY_LINKED: 'MEMBER_ALREADY_LINKED',
  ALREADY_WORKSPACE_MEMBER: 'ALREADY_WORKSPACE_MEMBER',
  // #628 BE PR #631 에 있고 아직 병합 전이다 (계약 §5.9)
  USER_ALREADY_INVITED: 'USER_ALREADY_INVITED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  PM_MEMBER_NOT_INVITABLE: 'PM_MEMBER_NOT_INVITABLE',
  MEMBER_HAS_PENDING_INVITATION: 'MEMBER_HAS_PENDING_INVITATION',
  // #356 에서 BE 와 합의했고 backend core/errors.py 에는 아직 없다 (계약 §4.1.1)
  PASSWORD_RESET_TOKEN_INVALID: 'PASSWORD_RESET_TOKEN_INVALID',
  MAIL_UNAVAILABLE: 'MAIL_UNAVAILABLE',
  SIGNUP_CODE_RATE_LIMITED: 'SIGNUP_CODE_RATE_LIMITED',
  SIGNUP_CODE_INVALID: 'SIGNUP_CODE_INVALID',
  SIGNUP_VERIFICATION_INVALID: 'SIGNUP_VERIFICATION_INVALID',
  KAKAO_LINK_EXPIRED: 'KAKAO_LINK_EXPIRED',
  KAKAO_ALREADY_LINKED: 'KAKAO_ALREADY_LINKED',
  // #627 BE PR #626 에 있고 아직 병합 전이다 (계약 §4.1.6)
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  // #457 BE PR #456 에 있고 아직 병합 전이다 (계약 §4.1)
  TOO_MANY_LOGIN_ATTEMPTS: 'TOO_MANY_LOGIN_ATTEMPTS',
  // #676 BE PR #670 에 있고 아직 병합 전이다. `details.reason` 이 `expired`·`no_recording` 이다 (계약 §2.3.1)
  AUDIO_NOT_AVAILABLE: 'AUDIO_NOT_AVAILABLE',
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

/**
 * 응답이 요청한 공간의 것이 아니다. 경로에 공간이 없는 조회가 캐시에 쓰기 전에 던진다 — 다른 공간의 데이터가
 * 이 공간의 key 로 성공 캐시에 들어가지 않는다. 서버 응답이 아니라 클라이언트 판정이라 kind 는 `invalid_response` 다(재시도 안 함)
 */
export function createWorkspaceMismatchError(
  requestedWorkspaceId: string,
  responseWorkspaceId: string,
): ApiError {
  return new ApiError(
    {
      code: ERROR_CODES.WORKSPACE_MISMATCH,
      message: 'response belongs to another workspace',
      details: {
        requested_workspace_id: requestedWorkspaceId,
        response_workspace_id: responseWorkspaceId,
      },
    },
    0,
    'invalid_response',
  )
}

/** `createWorkspaceMismatchError` 가 만든 오류다. 서버가 거절한 400 `WORKSPACE_MISMATCH` 는 아니다 */
export function isWorkspaceMismatch(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.kind === 'invalid_response' &&
    error.code === ERROR_CODES.WORKSPACE_MISMATCH
  )
}

/** 성공 응답을 읽지 못했다. 쓰기 요청이면 서버에는 이미 반영됐을 수 있다 (#348) */
export function isInvalidResponse(error: unknown): boolean {
  return error instanceof ApiError && error.code === CLIENT_ERROR_CODES.INVALID_RESPONSE
}

/** 우리 클라이언트의 취소와 TanStack Query 의 취소를 모두 취소로 본다 */
export function isCanceledError(error: unknown): boolean {
  return isCancelledError(error) || (error instanceof ApiError && error.kind === 'canceled')
}
