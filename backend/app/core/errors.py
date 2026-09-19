from enum import StrEnum
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class ErrorCode(StrEnum):
    INVALID_REQUEST = "INVALID_REQUEST"
    MEETING_NOT_FOUND = "MEETING_NOT_FOUND"
    MEETING_ALREADY_ENDED = "MEETING_ALREADY_ENDED"
    MEETING_NOT_PROCESSING = "MEETING_NOT_PROCESSING"
    AUDIO_UPLOAD_FAILED = "AUDIO_UPLOAD_FAILED"
    AUDIO_FORMAT_UNSUPPORTED = "AUDIO_FORMAT_UNSUPPORTED"
    TRANSCRIPTION_FAILED = "TRANSCRIPTION_FAILED"
    EXTRACTION_FAILED = "EXTRACTION_FAILED"
    EXTRACTION_NOT_FOUND = "EXTRACTION_NOT_FOUND"
    APPROVAL_NOT_FOUND = "APPROVAL_NOT_FOUND"
    APPROVAL_ALREADY_RESOLVED = "APPROVAL_ALREADY_RESOLVED"
    NOTION_WRITE_FAILED = "NOTION_WRITE_FAILED"
    WORKSPACE_NOT_FOUND = "WORKSPACE_NOT_FOUND"
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


ERROR_STATUS: dict[ErrorCode, int] = {
    ErrorCode.INVALID_REQUEST: 400,
    ErrorCode.MEETING_NOT_FOUND: 404,
    ErrorCode.MEETING_ALREADY_ENDED: 409,
    ErrorCode.MEETING_NOT_PROCESSING: 409,
    ErrorCode.AUDIO_UPLOAD_FAILED: 422,
    ErrorCode.AUDIO_FORMAT_UNSUPPORTED: 422,
    ErrorCode.TRANSCRIPTION_FAILED: 502,
    ErrorCode.EXTRACTION_FAILED: 502,
    ErrorCode.EXTRACTION_NOT_FOUND: 404,
    ErrorCode.APPROVAL_NOT_FOUND: 404,
    ErrorCode.APPROVAL_ALREADY_RESOLVED: 409,
    ErrorCode.NOTION_WRITE_FAILED: 502,
    ErrorCode.WORKSPACE_NOT_FOUND: 404,
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
}

ERROR_MESSAGE: dict[ErrorCode, str] = {
    ErrorCode.INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
    ErrorCode.MEETING_NOT_FOUND: "해당 회의 세션을 찾을 수 없습니다.",
    ErrorCode.MEETING_ALREADY_ENDED: "이미 종료된 회의 세션입니다.",
    ErrorCode.MEETING_NOT_PROCESSING: "회의가 분석 중(PROCESSING) 상태가 아닙니다.",
    ErrorCode.AUDIO_UPLOAD_FAILED: "오디오 저장·병합에 실패했습니다.",
    ErrorCode.AUDIO_FORMAT_UNSUPPORTED: "지원하지 않는 오디오 형식입니다.",
    ErrorCode.TRANSCRIPTION_FAILED: "음성 전사에 실패했습니다.",
    ErrorCode.EXTRACTION_FAILED: "회의 분석에 실패했습니다.",
    ErrorCode.EXTRACTION_NOT_FOUND: "해당 추출 결과를 찾을 수 없습니다.",
    ErrorCode.APPROVAL_NOT_FOUND: "해당 승인 요청을 찾을 수 없습니다.",
    ErrorCode.APPROVAL_ALREADY_RESOLVED: "이미 처리된 승인 요청입니다.",
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
    ) -> None:
        self.code = code
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

