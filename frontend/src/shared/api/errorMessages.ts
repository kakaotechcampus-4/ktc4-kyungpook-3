import { ApiError, isCanceledError } from './errors'
import type { ClientErrorCode, ErrorCode } from './errors'

/** 여러 화면이 함께 쓰는 문구 (D-149). 기능 전용 문구는 기능 가까이에 둔다 */
export const COMMON_MESSAGES = {
  retry: '다시 시도',
  loadFailed: '정보를 불러오지 못했어요',
  accessDenied: '접근 권한이 없어요',
  fallback: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
} as const

/* 서버 코드 31개 전부. `Record<ErrorCode, string>` 이라 코드가 늘면 여기서 타입 오류가 난다 */
const SERVER_MESSAGES: Record<ErrorCode, string> = {
  INVALID_REQUEST: '요청 내용을 다시 확인해 주세요.',
  MEETING_NOT_FOUND: '회의를 찾을 수 없어요.',
  MEETING_ALREADY_ENDED: '이미 끝난 회의예요.',
  MEETING_NOT_PROCESSING: '정리 중인 회의가 아니에요.',
  AUDIO_UPLOAD_FAILED: '파일을 올리지 못했어요. 다시 시도해 주세요.',
  AUDIO_FORMAT_UNSUPPORTED: '지원하지 않는 파일 형식이에요.',
  TRANSCRIPTION_FAILED: '회의 음성을 글로 옮기지 못했어요.',
  EXTRACTION_FAILED: '회의에서 할 일을 정리하지 못했어요.',
  EXTRACTION_NOT_FOUND: '정리 결과를 찾을 수 없어요.',
  APPROVAL_NOT_FOUND: '확인 요청을 찾을 수 없어요.',
  APPROVAL_ALREADY_RESOLVED: '이미 처리된 확인 요청이에요.',
  NOTION_WRITE_FAILED: 'Notion에 반영하지 못했어요.',
  WORKSPACE_NOT_FOUND: '워크스페이스를 찾을 수 없어요.',
  WORKSPACE_MISMATCH: '다른 워크스페이스의 항목이에요.',
  MEMBER_NOT_FOUND: '팀원을 찾을 수 없어요.',
  MEMBER_ALIAS_NOT_FOUND: '팀원 별칭을 찾을 수 없어요.',
  TASK_NOT_FOUND: '태스크를 찾을 수 없어요.',
  TASK_HISTORY_NOT_FOUND: '변경 기록을 찾을 수 없어요.',
  TASK_HISTORY_ALREADY_ROLLED_BACK: '이미 되돌린 변경이에요.',
  INTERNAL_ERROR: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
  UNAUTHENTICATED: '로그인이 필요해요.',
  FORBIDDEN: '접근 권한이 없어요.',
  EMAIL_ALREADY_EXISTS: '이미 가입된 이메일이에요.',
  INVALID_CREDENTIALS: '이메일 또는 비밀번호가 올바르지 않아요.',
  WORKSPACE_NAME_DUPLICATED: '이미 사용 중인 워크스페이스 이름이에요.',
  ONBOARDING_INCOMPLETE: '워크스페이스 설정을 먼저 마쳐 주세요.',
  INTEGRATION_NOT_CONNECTED: '연결이 필요해요. 설정에서 연결해 주세요.',
  INTEGRATION_REVOKED: '연결이 끊어졌어요. 다시 연결해 주세요.',
  MEETING_PROCESSING_IN_PROGRESS: '이미 정리 중인 회의가 있어요.',
  AUDIO_TOO_LARGE: '파일이 너무 커요.',
  DISCORD_USER_ALREADY_MAPPED: '이미 다른 팀원과 연결된 Discord 계정이에요.',
}

const CLIENT_MESSAGES: Record<ClientErrorCode, string> = {
  NETWORK_ERROR: '네트워크에 연결할 수 없어요. 연결을 확인해 주세요.',
  REQUEST_CANCELED: '요청을 취소했어요.',
  INVALID_RESPONSE: '응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.',
  UNKNOWN_ERROR: COMMON_MESSAGES.fallback,
}

const MESSAGES: Readonly<Record<string, string>> = { ...SERVER_MESSAGES, ...CLIENT_MESSAGES }

/** 오류 코드를 사용자 문구로 바꾼다. 서버 `message` 는 쓰지 않는다. 모르는 코드는 공통 문구다 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return COMMON_MESSAGES.fallback
  return Object.hasOwn(MESSAGES, error.code) ? MESSAGES[error.code] : COMMON_MESSAGES.fallback
}

/** 실패 알림에 쓸 문구. 취소는 실패가 아니므로 null 이다 — 알림을 띄우지 않는다 */
export function failureNotice(error: unknown): string | null {
  return isCanceledError(error) ? null : errorMessage(error)
}
