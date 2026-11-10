import { ApiError, isCanceledError } from './errors'
import type { ClientErrorCode, ErrorCode } from './errors'

/** 여러 화면이 함께 쓰는 문구 (D-149). 기능 전용 문구는 기능 가까이에 둔다 */
export const COMMON_MESSAGES = {
  retry: '다시 시도',
  loadFailed: '정보를 불러오지 못했어요',
  accessDenied: '접근 권한이 없어요',
  fallback: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
} as const

/** 쓰기 요청의 응답을 읽지 못했을 때. 서버에는 반영됐을 수 있어 실패라고 하지 않는다 (#348) */
export const WRITE_UNCONFIRMED_MESSAGES = {
  title: '변경 결과를 확인하지 못했어요',
  description: '서버에는 반영됐을 수 있어요. 새로고침해서 지금 상태를 확인해 주세요.',
  refresh: '새로고침',
} as const

/* 서버 코드 전부 (backend core/errors.py). AI 경로에서만 오는 코드는 뺐다(계약 §2.3.1). 비밀번호 재설정의 두 코드는 합의만 됐고 BE 에 아직 없다(계약 §4.1.1).
   로그인 시도 제한은 BE PR #456 이 병합 전이고, 서버 문장을 그대로 쓴다 — 남은 시간도 잠금도 말하지 않는다 (#457) */
const SERVER_MESSAGES: Record<ErrorCode, string> = {
  CONSENT_VERSION_MISMATCH: '문서 판본이 바뀌었어요. 문서를 다시 확인해 주세요.',
  CONSENT_ACCOUNT_CHANGED: '로그인한 계정이 바뀌었어요. 새로고침해서 다시 확인해 주세요.',
  INVALID_REQUEST: '요청 내용을 다시 확인해 주세요.',
  MEETING_NOT_FOUND: '회의를 찾을 수 없어요.',
  MEETING_ALREADY_ENDED: '이미 끝난 회의예요.',
  MEETING_NOT_PROCESSING: '정리 중인 회의가 아니에요.',
  MEETING_NOT_AWAITING_SPEAKERS: '화자를 지정할 수 있는 회의가 아니에요.',
  AUDIO_UPLOAD_FAILED: '파일을 올리지 못했어요. 다시 시도해 주세요.',
  AUDIO_FORMAT_UNSUPPORTED: '지원하지 않는 파일 형식이에요.',
  TRANSCRIPTION_FAILED: '회의 음성을 글로 옮기지 못했어요.',
  EXTRACTION_FAILED: '회의에서 할 일을 정리하지 못했어요.',
  EXTRACTION_NOT_FOUND: '정리 결과를 찾을 수 없어요.',
  EXTRACTION_ITEM_NOT_FOUND: '정리 결과의 항목을 찾을 수 없어요.',
  AUTO_TASK_NOT_REVERTIBLE: '자동으로 만든 태스크를 되돌릴 수 없어요. 태스크를 직접 고쳐 주세요.',
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
  TOPIC_NOT_FOUND: '주제를 찾을 수 없어요. 지워졌을 수 있어요.',
  TOPIC_NAME_TAKEN: '같은 이름의 주제가 이미 있어요.',
  DECISION_NOT_FOUND: '결정을 찾을 수 없어요. 지워졌을 수 있어요.',
  SUMMARY_NOT_FOUND: '이 회의의 요약본이 아직 없어요.',
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
  MEETING_FAILED: '실패한 회의예요. 새 회의로 다시 시작해 주세요.',
  APPROVAL_CONFLICT: '제안 뒤에 태스크가 바뀌었어요. 지금 값을 확인한 뒤 다시 승인해 주세요.',
  APPROVAL_CHANGED: '보신 뒤에 확인 요청 내용이 바뀌었어요. 새 내용을 확인하고 다시 처리해 주세요.',
  LAST_PM_REQUIRED:
    '워크스페이스에 PM이 한 명은 있어야 해요. 다른 팀원을 먼저 PM으로 지정해 주세요.',
  EMBEDDING_UNAVAILABLE: '비슷한 태스크를 찾지 못했어요. 잠시 후 다시 시도해 주세요.',
  DISCORD_API_FAILED: 'Discord 서버의 사용자 목록을 가져오지 못했어요. 잠시 후 다시 시도해 주세요.',
  DISCORD_CHANNEL_NOT_FOUND:
    '연결된 Discord 서버에서 이 텍스트 채널을 찾을 수 없어요. 목록을 새로고침해 주세요.',
  DISCORD_CHANNEL_NOT_ACCESSIBLE:
    '봇이 이 채널을 읽거나 메시지를 보낼 수 없어요. 채널 권한에 봇을 추가해 주세요.',
  NOTIFICATION_NOT_FOUND: '알림을 찾을 수 없어요.',
  AUTO_BLOCK_NOT_FOUND:
    '막힌 뒤 상태나 사유가 바뀌어 되돌릴 수 없어요. 최신 태스크를 다시 불러왔어요.',
  REPLY_JUDGMENT_NOT_FOUND: '이 답장의 판단 기록을 찾을 수 없어요.',
  REPLY_ATTRIBUTION_NOT_NEEDED: '이미 태스크를 정한 답장이에요.',
  REPLY_CHANGE_NOT_UNDOABLE:
    '그 뒤에 태스크가 바뀌어 되돌릴 수 없어요. 최신 태스크를 다시 불러왔어요.',
  INVITATION_NOT_FOUND: '초대를 찾을 수 없어요.',
  INVITATION_NOT_PENDING: '이미 처리된 초대예요.',
  INVITATION_NOT_ACCEPTED: '수락하지 않은 초대라 연결을 끊을 수 없어요.',
  MEMBER_ALREADY_LINKED: '이미 로그인 계정이 연결된 팀원이에요.',
  ALREADY_WORKSPACE_MEMBER: '이미 이 워크스페이스에 속한 계정이에요.',
  USER_ALREADY_INVITED:
    '이 사용자에게 다른 팀원으로 보낸 초대가 기다리고 있어요. 그 초대를 먼저 취소해 주세요.',
  USER_NOT_FOUND: '가입한 사용자를 찾을 수 없어요. 아이디를 다시 찾아 주세요.',
  PM_MEMBER_NOT_INVITABLE:
    'PM인 팀원은 초대할 수 없어요. 팀원 역할로 초대하고, 수락한 뒤 PM으로 바꿔 주세요.',
  MEMBER_HAS_PENDING_INVITATION: '초대를 수락한 뒤 바꾸거나 초대를 취소해 주세요.',
  PASSWORD_RESET_TOKEN_INVALID: '쓸 수 없는 링크예요. 비밀번호 재설정을 다시 요청해 주세요.',
  MAIL_UNAVAILABLE: '지금은 메일을 보낼 수 없어요. 잠시 뒤 다시 시도해 주세요.',
  SIGNUP_CODE_RATE_LIMITED: '인증 코드를 너무 자주 요청했어요. 잠시 뒤 다시 시도해 주세요.',
  SIGNUP_CODE_INVALID: '인증 코드가 맞지 않아요.',
  SIGNUP_VERIFICATION_INVALID: '이메일 인증 시간이 지났어요. 이메일 인증을 다시 해 주세요.',
  KAKAO_LINK_EXPIRED: '카카오 로그인 정보가 만료됐어요. 카카오로 다시 시작해 주세요.',
  KAKAO_ALREADY_LINKED: '이미 다른 계정에 연결된 카카오 계정이에요.',
  USERNAME_TAKEN: '이미 사용 중인 아이디예요.',
  TOO_MANY_LOGIN_ATTEMPTS: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
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
