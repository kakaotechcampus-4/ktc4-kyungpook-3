from enum import StrEnum
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ErrorCode(StrEnum):
    INVALID_REQUEST = "INVALID_REQUEST"
    MEETING_NOT_FOUND = "MEETING_NOT_FOUND"
    MEETING_DELETED = "MEETING_DELETED"
    MEETING_DELETE_BLOCKED = "MEETING_DELETE_BLOCKED"
    MEETING_DELETION_UNAVAILABLE = "MEETING_DELETION_UNAVAILABLE"
    MEETING_LINEAGE_UNVERIFIED = "MEETING_LINEAGE_UNVERIFIED"
    MEETING_CLIENT_UPDATE_REQUIRED = "MEETING_CLIENT_UPDATE_REQUIRED"
    PURGE_CLAIM_EXPIRED = "PURGE_CLAIM_EXPIRED"
    MEETING_ALREADY_ENDED = "MEETING_ALREADY_ENDED"
    MEETING_NOT_PROCESSING = "MEETING_NOT_PROCESSING"
    MEETING_FAILED = "MEETING_FAILED"
    AUDIO_UPLOAD_FAILED = "AUDIO_UPLOAD_FAILED"
    AUDIO_FORMAT_UNSUPPORTED = "AUDIO_FORMAT_UNSUPPORTED"
    TRANSCRIPTION_FAILED = "TRANSCRIPTION_FAILED"
    EXTRACTION_FAILED = "EXTRACTION_FAILED"
    EXTRACTION_NOT_FOUND = "EXTRACTION_NOT_FOUND"
    EXTRACTION_ITEM_NOT_FOUND = "EXTRACTION_ITEM_NOT_FOUND"
    AUTO_TASK_NOT_REVERTIBLE = "AUTO_TASK_NOT_REVERTIBLE"
    APPROVAL_NOT_FOUND = "APPROVAL_NOT_FOUND"
    APPROVAL_ALREADY_RESOLVED = "APPROVAL_ALREADY_RESOLVED"
    APPROVAL_CONFLICT = "APPROVAL_CONFLICT"
    APPROVAL_CHANGED = "APPROVAL_CHANGED"
    NOTION_WRITE_FAILED = "NOTION_WRITE_FAILED"
    WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND"
    PRIVACY_VERSION_CHANGED = "PRIVACY_VERSION_CHANGED"
    WITHDRAWAL_ACCOUNT_CHANGED = "WITHDRAWAL_ACCOUNT_CHANGED"
    WORKSPACE_MISMATCH = "WORKSPACE_MISMATCH"
    MEMBER_NOT_FOUND = "MEMBER_NOT_FOUND"
    MEMBER_ALIAS_NOT_FOUND = "MEMBER_ALIAS_NOT_FOUND"
    TASK_NOT_FOUND = "TASK_NOT_FOUND"
    TASK_HISTORY_NOT_FOUND = "TASK_HISTORY_NOT_FOUND"
    TASK_HISTORY_ALREADY_ROLLED_BACK = "TASK_HISTORY_ALREADY_ROLLED_BACK"
    INTERNAL_ERROR = "INTERNAL_ERROR"

    # §4.9 — 신규 API(§4.1~§4.5)에 필요한 오류 코드
    UNAUTHENTICATED = "UNAUTHENTICATED"
    FORBIDDEN = "FORBIDDEN"
    EMAIL_ALREADY_EXISTS = "EMAIL_ALREADY_EXISTS"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    WORKSPACE_NAME_DUPLICATED = "WORKSPACE_NAME_DUPLICATED"
    ONBOARDING_INCOMPLETE = "ONBOARDING_INCOMPLETE"
    INTEGRATION_NOT_CONNECTED = "INTEGRATION_NOT_CONNECTED"
    INTEGRATION_REVOKED = "INTEGRATION_REVOKED"
    MEETING_PROCESSING_IN_PROGRESS = "MEETING_PROCESSING_IN_PROGRESS"
    AUDIO_TOO_LARGE = "AUDIO_TOO_LARGE"
    DISCORD_USER_ALREADY_MAPPED = "DISCORD_USER_ALREADY_MAPPED"
    MEMBER_NAME_DUPLICATED = "MEMBER_NAME_DUPLICATED"
    LAST_PM_REQUIRED = "LAST_PM_REQUIRED"
    EMBEDDING_UNAVAILABLE = "EMBEDDING_UNAVAILABLE"
    DISCORD_API_FAILED = "DISCORD_API_FAILED"
    DISCORD_CHANNEL_NOT_FOUND = "DISCORD_CHANNEL_NOT_FOUND"
    DISCORD_CHANNEL_NOT_ACCESSIBLE = "DISCORD_CHANNEL_NOT_ACCESSIBLE"
    UPLOAD_NOT_CLAIMED = "UPLOAD_NOT_CLAIMED"
    SPEAKERS_ALREADY_REPORTED = "SPEAKERS_ALREADY_REPORTED"
    MEETING_NOT_AWAITING_SPEAKERS = "MEETING_NOT_AWAITING_SPEAKERS"
    SPEAKERS_NOT_ASSIGNED = "SPEAKERS_NOT_ASSIGNED"

    # 리마인드·대화 메시지
    REMINDER_NOT_FOUND = "REMINDER_NOT_FOUND"
    REMINDER_NOT_EDITABLE = "REMINDER_NOT_EDITABLE"
    REMINDER_SCHEDULED_AT_PASSED = "REMINDER_SCHEDULED_AT_PASSED"
    REMINDER_BUNDLE_NOT_FOUND = "REMINDER_BUNDLE_NOT_FOUND"
    BUNDLE_CHANGED = "BUNDLE_CHANGED"
    DRAFT_STALE = "DRAFT_STALE"
    MESSAGE_THREAD_NOT_FOUND = "MESSAGE_THREAD_NOT_FOUND"
    MESSAGE_NOT_FOUND = "MESSAGE_NOT_FOUND"
    MESSAGE_RESULT_CONFLICT = "MESSAGE_RESULT_CONFLICT"
    NOTIFICATION_NOT_FOUND = "NOTIFICATION_NOT_FOUND"
    AUTO_BLOCK_NOT_FOUND = "AUTO_BLOCK_NOT_FOUND"

    # 팀원 초대
    INVITATION_NOT_FOUND = "INVITATION_NOT_FOUND"
    USER_NOT_FOUND = "USER_NOT_FOUND"
    INVITATION_NOT_PENDING = "INVITATION_NOT_PENDING"
    INVITATION_NOT_ACCEPTED = "INVITATION_NOT_ACCEPTED"
    MEMBER_ALREADY_LINKED = "MEMBER_ALREADY_LINKED"
    ALREADY_WORKSPACE_MEMBER = "ALREADY_WORKSPACE_MEMBER"
    USER_ALREADY_INVITED = "USER_ALREADY_INVITED"
    PM_MEMBER_NOT_INVITABLE = "PM_MEMBER_NOT_INVITABLE"
    MEMBER_HAS_PENDING_INVITATION = "MEMBER_HAS_PENDING_INVITATION"

    # 리마인드 답장 판단
    REPLY_JUDGMENT_NOT_FOUND = "REPLY_JUDGMENT_NOT_FOUND"
    REPLY_JUDGMENT_STALE = "REPLY_JUDGMENT_STALE"
    REPLY_ATTRIBUTION_NOT_NEEDED = "REPLY_ATTRIBUTION_NOT_NEEDED"
    REPLY_CHANGE_NOT_UNDOABLE = "REPLY_CHANGE_NOT_UNDOABLE"
    # 비밀번호 재설정
    PASSWORD_RESET_TOKEN_INVALID = "PASSWORD_RESET_TOKEN_INVALID"
    MAIL_UNAVAILABLE = "MAIL_UNAVAILABLE"
    # 회의 요약·프로젝트 맵
    TOPIC_NOT_FOUND = "TOPIC_NOT_FOUND"
    SUMMARY_NOT_FOUND = "SUMMARY_NOT_FOUND"

    # 가입 이메일 인증·카카오 로그인
    SIGNUP_CODE_RATE_LIMITED = "SIGNUP_CODE_RATE_LIMITED"
    SIGNUP_CODE_INVALID = "SIGNUP_CODE_INVALID"
    SIGNUP_VERIFICATION_INVALID = "SIGNUP_VERIFICATION_INVALID"
    KAKAO_LINK_EXPIRED = "KAKAO_LINK_EXPIRED"
    KAKAO_ALREADY_LINKED = "KAKAO_ALREADY_LINKED"
    USERNAME_TAKEN = "USERNAME_TAKEN"
    # 로그인 시도 제한
    TOO_MANY_LOGIN_ATTEMPTS = "TOO_MANY_LOGIN_ATTEMPTS"

    # 약관·개인정보처리방침 동의
    CONSENT_VERSION_MISMATCH = "CONSENT_VERSION_MISMATCH"
    CONSENT_ACCOUNT_CHANGED = "CONSENT_ACCOUNT_CHANGED"


ERROR_STATUS: dict[ErrorCode, int] = {
    ErrorCode.INVALID_REQUEST: 400,
    ErrorCode.MEETING_NOT_FOUND: 404,
    ErrorCode.MEETING_DELETED: 410,
    ErrorCode.MEETING_DELETION_UNAVAILABLE: 503,
    ErrorCode.MEETING_LINEAGE_UNVERIFIED: 409,
    ErrorCode.MEETING_CLIENT_UPDATE_REQUIRED: 409,
    ErrorCode.MEETING_DELETE_BLOCKED: 409,
    ErrorCode.PURGE_CLAIM_EXPIRED: 409,
    ErrorCode.MEETING_ALREADY_ENDED: 409,
    ErrorCode.MEETING_NOT_PROCESSING: 409,
    ErrorCode.MEETING_FAILED: 409,
    ErrorCode.AUDIO_UPLOAD_FAILED: 422,
    ErrorCode.AUDIO_FORMAT_UNSUPPORTED: 422,
    ErrorCode.TRANSCRIPTION_FAILED: 502,
    ErrorCode.EXTRACTION_FAILED: 502,
    ErrorCode.EXTRACTION_NOT_FOUND: 404,
    ErrorCode.EXTRACTION_ITEM_NOT_FOUND: 404,
    ErrorCode.AUTO_TASK_NOT_REVERTIBLE: 409,
    ErrorCode.APPROVAL_NOT_FOUND: 404,
    ErrorCode.APPROVAL_ALREADY_RESOLVED: 409,
    ErrorCode.APPROVAL_CONFLICT: 409,
    ErrorCode.APPROVAL_CHANGED: 409,
    ErrorCode.NOTION_WRITE_FAILED: 502,
    ErrorCode.WORKSPACE_NOT_FOUND: 404,
    ErrorCode.PRIVACY_VERSION_CHANGED: 409,
    ErrorCode.WITHDRAWAL_ACCOUNT_CHANGED: 409,
    ErrorCode.WORKSPACE_MISMATCH: 400,
    ErrorCode.MEMBER_NOT_FOUND: 404,
    ErrorCode.MEMBER_ALIAS_NOT_FOUND: 404,
    ErrorCode.TASK_NOT_FOUND: 404,
    ErrorCode.TASK_HISTORY_NOT_FOUND: 404,
    ErrorCode.TASK_HISTORY_ALREADY_ROLLED_BACK: 409,
    ErrorCode.INTERNAL_ERROR: 500,
    ErrorCode.UNAUTHENTICATED: 401,
    ErrorCode.FORBIDDEN: 403,
    ErrorCode.EMAIL_ALREADY_EXISTS: 409,
    ErrorCode.INVALID_CREDENTIALS: 401,
    ErrorCode.WORKSPACE_NAME_DUPLICATED: 409,
    ErrorCode.ONBOARDING_INCOMPLETE: 403,
    ErrorCode.INTEGRATION_NOT_CONNECTED: 409,
    ErrorCode.INTEGRATION_REVOKED: 409,
    ErrorCode.MEETING_PROCESSING_IN_PROGRESS: 409,
    ErrorCode.AUDIO_TOO_LARGE: 413,
    ErrorCode.DISCORD_USER_ALREADY_MAPPED: 409,
    ErrorCode.MEMBER_NAME_DUPLICATED: 409,
    ErrorCode.LAST_PM_REQUIRED: 409,
    ErrorCode.EMBEDDING_UNAVAILABLE: 502,
    ErrorCode.DISCORD_API_FAILED: 502,
    ErrorCode.DISCORD_CHANNEL_NOT_FOUND: 404,
    ErrorCode.DISCORD_CHANNEL_NOT_ACCESSIBLE: 409,
    ErrorCode.UPLOAD_NOT_CLAIMED: 409,
    ErrorCode.SPEAKERS_ALREADY_REPORTED: 409,
    ErrorCode.MEETING_NOT_AWAITING_SPEAKERS: 409,
    ErrorCode.SPEAKERS_NOT_ASSIGNED: 409,
    ErrorCode.REMINDER_NOT_FOUND: 404,
    ErrorCode.REMINDER_NOT_EDITABLE: 409,
    ErrorCode.REMINDER_SCHEDULED_AT_PASSED: 409,
    ErrorCode.REMINDER_BUNDLE_NOT_FOUND: 404,
    ErrorCode.BUNDLE_CHANGED: 409,
    ErrorCode.DRAFT_STALE: 409,
    ErrorCode.MESSAGE_THREAD_NOT_FOUND: 404,
    ErrorCode.MESSAGE_NOT_FOUND: 404,
    ErrorCode.MESSAGE_RESULT_CONFLICT: 409,
    ErrorCode.NOTIFICATION_NOT_FOUND: 404,
    ErrorCode.AUTO_BLOCK_NOT_FOUND: 409,
    ErrorCode.INVITATION_NOT_FOUND: 404,
    ErrorCode.USER_NOT_FOUND: 404,
    ErrorCode.INVITATION_NOT_PENDING: 409,
    ErrorCode.INVITATION_NOT_ACCEPTED: 409,
    ErrorCode.MEMBER_ALREADY_LINKED: 409,
    ErrorCode.ALREADY_WORKSPACE_MEMBER: 409,
    ErrorCode.USER_ALREADY_INVITED: 409,
    ErrorCode.PM_MEMBER_NOT_INVITABLE: 409,
    ErrorCode.MEMBER_HAS_PENDING_INVITATION: 409,
    ErrorCode.REPLY_JUDGMENT_NOT_FOUND: 404,
    ErrorCode.REPLY_JUDGMENT_STALE: 409,
    ErrorCode.REPLY_ATTRIBUTION_NOT_NEEDED: 409,
    ErrorCode.REPLY_CHANGE_NOT_UNDOABLE: 409,
    ErrorCode.PASSWORD_RESET_TOKEN_INVALID: 400,
    ErrorCode.MAIL_UNAVAILABLE: 503,
    ErrorCode.TOPIC_NOT_FOUND: 404,
    ErrorCode.SUMMARY_NOT_FOUND: 404,
    ErrorCode.SIGNUP_CODE_RATE_LIMITED: 429,
    ErrorCode.SIGNUP_CODE_INVALID: 400,
    ErrorCode.SIGNUP_VERIFICATION_INVALID: 400,
    ErrorCode.KAKAO_LINK_EXPIRED: 400,
    ErrorCode.KAKAO_ALREADY_LINKED: 409,
    ErrorCode.USERNAME_TAKEN: 409,
    ErrorCode.TOO_MANY_LOGIN_ATTEMPTS: 429,
    ErrorCode.CONSENT_VERSION_MISMATCH: 400,
    ErrorCode.CONSENT_ACCOUNT_CHANGED: 409,
}

ERROR_MESSAGE: dict[ErrorCode, str] = {
    ErrorCode.MEETING_DELETED: "삭제된 회의입니다.",
    ErrorCode.MEETING_DELETION_UNAVAILABLE: "회의 삭제 기능을 준비하고 있습니다.",
    ErrorCode.MEETING_LINEAGE_UNVERIFIED: "회의 재처리 기록을 확인한 뒤 삭제할 수 있습니다.",
    ErrorCode.MEETING_CLIENT_UPDATE_REQUIRED: "녹음 봇을 최신 버전으로 업데이트해 주세요.",
    ErrorCode.MEETING_DELETE_BLOCKED: "처리 중인 회의는 삭제할 수 없습니다.",
    ErrorCode.PURGE_CLAIM_EXPIRED: "파일 정리 작업의 처리 권한이 만료되었습니다.",
    ErrorCode.INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
    ErrorCode.MEETING_NOT_FOUND: "해당 회의 세션을 찾을 수 없습니다.",
    ErrorCode.MEETING_ALREADY_ENDED: "이미 종료된 회의 세션입니다.",
    ErrorCode.MEETING_NOT_PROCESSING: "회의가 분석 중(PROCESSING) 상태가 아닙니다.",
    ErrorCode.MEETING_FAILED: "실패 처리된 회의입니다. 새 회의로 다시 시작해 주세요.",
    ErrorCode.AUDIO_UPLOAD_FAILED: "오디오 저장·병합에 실패했습니다.",
    ErrorCode.AUDIO_FORMAT_UNSUPPORTED: "지원하지 않는 오디오 형식입니다.",
    ErrorCode.TRANSCRIPTION_FAILED: "음성 전사에 실패했습니다.",
    ErrorCode.EXTRACTION_FAILED: "회의 분석에 실패했습니다.",
    ErrorCode.EXTRACTION_NOT_FOUND: "해당 추출 결과를 찾을 수 없습니다.",
    ErrorCode.EXTRACTION_ITEM_NOT_FOUND: "해당 추출 항목을 찾을 수 없습니다.",
    ErrorCode.AUTO_TASK_NOT_REVERTIBLE: "자동으로 만든 태스크를 되돌릴 수 없습니다. 태스크를 직접 수정해 주세요.",
    ErrorCode.APPROVAL_NOT_FOUND: "해당 승인 요청을 찾을 수 없습니다.",
    ErrorCode.APPROVAL_ALREADY_RESOLVED: "이미 처리된 승인 요청입니다.",
    ErrorCode.APPROVAL_CONFLICT: "제안 이후 task가 바뀌었습니다. 지금 값을 확인한 뒤 다시 승인해 주세요.",
    ErrorCode.APPROVAL_CHANGED: "보신 뒤 승인 요청 내용이 바뀌었습니다. 새 내용을 확인한 뒤 다시 처리해 주세요.",
    ErrorCode.NOTION_WRITE_FAILED: "Notion 반영에 실패했습니다.",
    ErrorCode.WORKSPACE_NOT_FOUND: "해당 워크스페이스를 찾을 수 없습니다.",
    ErrorCode.WORKSPACE_MISMATCH: "요청한 워크스페이스가 대상 리소스의 워크스페이스와 다릅니다.",
    ErrorCode.MEMBER_NOT_FOUND: "해당 팀원을 찾을 수 없습니다.",
    ErrorCode.MEMBER_ALIAS_NOT_FOUND: "해당 별칭을 찾을 수 없습니다.",
    ErrorCode.TASK_NOT_FOUND: "해당 태스크를 찾을 수 없습니다.",
    ErrorCode.TASK_HISTORY_NOT_FOUND: "해당 반영 로그를 찾을 수 없습니다.",
    ErrorCode.TASK_HISTORY_ALREADY_ROLLED_BACK: "이미 되돌린 변경입니다.",
    ErrorCode.INTERNAL_ERROR: "서버 내부 오류가 발생했습니다.",
    ErrorCode.UNAUTHENTICATED: "로그인이 필요합니다.",
    ErrorCode.FORBIDDEN: "이 작업을 수행할 권한이 없습니다.",
    ErrorCode.EMAIL_ALREADY_EXISTS: "이미 가입된 이메일입니다.",
    ErrorCode.INVALID_CREDENTIALS: "이메일 또는 비밀번호가 올바르지 않습니다.",
    ErrorCode.WORKSPACE_NAME_DUPLICATED: "이미 사용 중인 워크스페이스 이름입니다.",
    ErrorCode.ONBOARDING_INCOMPLETE: "워크스페이스 온보딩이 완료되지 않았습니다.",
    ErrorCode.INTEGRATION_NOT_CONNECTED: "연동이 필요합니다.",
    ErrorCode.INTEGRATION_REVOKED: "연동이 끊어졌습니다. 다시 연결해 주세요.",
    ErrorCode.MEETING_PROCESSING_IN_PROGRESS: "이미 처리 중인 회의가 있습니다.",
    ErrorCode.AUDIO_TOO_LARGE: "오디오 파일 용량이 너무 큽니다.",
    ErrorCode.DISCORD_USER_ALREADY_MAPPED: "이미 다른 팀원에 연결된 Discord 사용자입니다.",
    ErrorCode.MEMBER_NAME_DUPLICATED: "같은 이름의 팀원이 이미 있습니다.",
    ErrorCode.LAST_PM_REQUIRED: "워크스페이스에 PM이 한 명은 있어야 합니다. 다른 팀원을 먼저 PM으로 지정해 주세요.",
    ErrorCode.EMBEDDING_UNAVAILABLE: "임베딩 서버 호출에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    ErrorCode.DISCORD_API_FAILED: "Discord 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    ErrorCode.DISCORD_CHANNEL_NOT_FOUND: "연결된 Discord 서버에서 이 텍스트 채널을 찾을 수 없습니다. 목록을 새로고침해 주세요.",
    ErrorCode.DISCORD_CHANNEL_NOT_ACCESSIBLE: "봇이 이 채널을 읽거나 메시지를 보낼 수 없습니다. 채널 권한에 봇을 추가해 주세요.",
    ErrorCode.UPLOAD_NOT_CLAIMED: "AI가 아직 가져가지 않은 업로드입니다.",
    ErrorCode.SPEAKERS_ALREADY_REPORTED: "이미 화자 목록을 받은 업로드입니다.",
    ErrorCode.MEETING_NOT_AWAITING_SPEAKERS: "회의가 화자 지정 대기 상태가 아닙니다.",
    ErrorCode.SPEAKERS_NOT_ASSIGNED: "화자 지정이 끝나지 않았습니다.",
    ErrorCode.REMINDER_NOT_FOUND: "해당 리마인드를 찾을 수 없습니다.",
    ErrorCode.REMINDER_NOT_EDITABLE: "예정 상태의 리마인드만 고치거나 승인하거나 취소할 수 있습니다.",
    ErrorCode.REMINDER_SCHEDULED_AT_PASSED: "예정 시각이 지났어요. 시각을 다시 골라 주세요.",
    ErrorCode.REMINDER_BUNDLE_NOT_FOUND: "해당 보낼 메시지를 찾을 수 없습니다.",
    ErrorCode.BUNDLE_CHANGED: "보낼 메시지가 바뀌었어요. 다시 확인해 주세요.",
    ErrorCode.DRAFT_STALE: "초안을 맡긴 뒤 보낼 메시지가 바뀌었거나 이미 승인·발송됐습니다.",
    ErrorCode.MESSAGE_THREAD_NOT_FOUND: "해당 대화를 찾을 수 없습니다.",
    ErrorCode.MESSAGE_NOT_FOUND: "해당 봇 메시지를 찾을 수 없습니다.",
    ErrorCode.MESSAGE_RESULT_CONFLICT: "이미 다른 결과가 보고된 메시지이거나 아직 가져가지 않은 메시지입니다.",
    ErrorCode.NOTIFICATION_NOT_FOUND: "알림을 찾을 수 없습니다.",
    ErrorCode.AUTO_BLOCK_NOT_FOUND: "스케줄러가 건 막힘이 아니거나 그 뒤 바뀌어 되돌릴 수 없습니다.",
    ErrorCode.INVITATION_NOT_FOUND: "해당 초대를 찾을 수 없습니다.",
    ErrorCode.USER_NOT_FOUND: "해당 사용자를 찾을 수 없습니다.",
    ErrorCode.INVITATION_NOT_PENDING: "이미 수락·거절·취소된 초대입니다.",
    ErrorCode.INVITATION_NOT_ACCEPTED: "수락한 초대만 연결을 끊을 수 있습니다.",
    ErrorCode.MEMBER_ALREADY_LINKED: "이미 로그인 계정이 연결된 팀원입니다.",
    ErrorCode.ALREADY_WORKSPACE_MEMBER: "이미 이 워크스페이스의 팀원인 계정입니다.",
    ErrorCode.USER_ALREADY_INVITED: "이 사용자에게 다른 팀원으로 보낸 초대가 대기 중입니다.",
    ErrorCode.PM_MEMBER_NOT_INVITABLE: "PM 인 팀원은 초대할 수 없습니다. 팀원으로 바꿔 초대하고, 수락한 뒤 PM 으로 바꿔 주세요.",
    ErrorCode.MEMBER_HAS_PENDING_INVITATION: "대기 중인 초대가 있어 PM 으로 바꿀 수 없습니다. 초대를 수락한 뒤 바꾸거나 초대를 취소해 주세요.",
    ErrorCode.REPLY_JUDGMENT_NOT_FOUND: "해당 답장의 판단 기록을 찾을 수 없습니다.",
    ErrorCode.REPLY_JUDGMENT_STALE: "이미 끝났거나 다시 맡긴 판단입니다.",
    ErrorCode.REPLY_ATTRIBUTION_NOT_NEEDED: "태스크를 고를 필요가 없는 답장입니다.",
    ErrorCode.REPLY_CHANGE_NOT_UNDOABLE: "되돌릴 수 없는 답장 변경입니다.",
    ErrorCode.PASSWORD_RESET_TOKEN_INVALID: "쓸 수 없는 재설정 링크입니다.",
    ErrorCode.MAIL_UNAVAILABLE: "지금은 메일을 보낼 수 없습니다.",
    ErrorCode.TOPIC_NOT_FOUND: "해당 주제를 찾을 수 없습니다.",
    ErrorCode.SUMMARY_NOT_FOUND: "이 회의의 요약본이 아직 없습니다.",
    ErrorCode.SIGNUP_CODE_RATE_LIMITED: "인증 코드를 너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요.",
    ErrorCode.SIGNUP_CODE_INVALID: "인증 코드가 맞지 않습니다.",
    ErrorCode.SIGNUP_VERIFICATION_INVALID: "이메일 인증이 필요합니다. 인증을 다시 진행해 주세요.",
    ErrorCode.KAKAO_LINK_EXPIRED: "카카오 로그인 정보가 만료됐습니다. 카카오로 다시 시작해 주세요.",
    ErrorCode.KAKAO_ALREADY_LINKED: "이미 다른 계정에 연결된 카카오 계정입니다.",
    ErrorCode.USERNAME_TAKEN: "이미 사용 중인 아이디입니다.",
    ErrorCode.TOO_MANY_LOGIN_ATTEMPTS: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    ErrorCode.CONSENT_VERSION_MISMATCH: "지금 문서 버전이 아닙니다. 문서를 다시 확인해 주세요.",
    ErrorCode.CONSENT_ACCOUNT_CHANGED: "로그인한 계정이 바뀌었습니다. 계정을 다시 확인해 주세요.",
}


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class Envelope(BaseModel, Generic[T]):
    """모든 엔드포인트가 공통으로 쓰는 응답 봉투.

    Swagger가 실제 응답 모양을 보여주도록 각 라우터의 response_model에
    Envelope[XxxResponse] 형태로 붙여 쓴다. success()/failure()는 그대로
    dict를 반환하고, FastAPI가 이 모델로 검증·직렬화한다.
    """

    data: T | None
    error: ErrorDetail | None


class AppError(Exception):
    def __init__(
        self,
        code: ErrorCode,
        message: str | None = None,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.code = code
        self.headers = headers
        self.message = message or ERROR_MESSAGE.get(code, "오류가 발생했습니다.")
        self.details = details
        self.status_code = ERROR_STATUS.get(code, 500)
        super().__init__(self.message)


def success(data: Any) -> dict[str, Any]:
    return {"data": data, "error": None}


def failure(
    code: ErrorCode,
    message: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    error = ErrorDetail(
        code=str(code),
        message=message or ERROR_MESSAGE.get(code, "오류가 발생했습니다."),
        details=details,
    )
    return {"data": None, "error": error.model_dump()}

