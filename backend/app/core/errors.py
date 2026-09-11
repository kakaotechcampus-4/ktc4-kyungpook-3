from enum import StrEnum
from typing import Any

from pydantic import BaseModel


class ErrorCode(StrEnum):
    INVALID_REQUEST = "INVALID_REQUEST"
    MEETING_NOT_FOUND = "MEETING_NOT_FOUND"
    MEETING_ALREADY_ENDED = "MEETING_ALREADY_ENDED"
    AUDIO_UPLOAD_FAILED = "AUDIO_UPLOAD_FAILED"
    AUDIO_FORMAT_UNSUPPORTED = "AUDIO_FORMAT_UNSUPPORTED"
    TRANSCRIPTION_FAILED = "TRANSCRIPTION_FAILED"
    EXTRACTION_FAILED = "EXTRACTION_FAILED"
    EXTRACTION_NOT_FOUND = "EXTRACTION_NOT_FOUND"
    APPROVAL_NOT_FOUND = "APPROVAL_NOT_FOUND"
    NOTION_WRITE_FAILED = "NOTION_WRITE_FAILED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


ERROR_STATUS: dict[ErrorCode, int] = {
    ErrorCode.INVALID_REQUEST: 400,
    ErrorCode.MEETING_NOT_FOUND: 404,
    ErrorCode.MEETING_ALREADY_ENDED: 409,
    ErrorCode.AUDIO_UPLOAD_FAILED: 422,
    ErrorCode.AUDIO_FORMAT_UNSUPPORTED: 422,
    ErrorCode.TRANSCRIPTION_FAILED: 502,
    ErrorCode.EXTRACTION_FAILED: 502,
    ErrorCode.EXTRACTION_NOT_FOUND: 404,
    ErrorCode.APPROVAL_NOT_FOUND: 404,
    ErrorCode.NOTION_WRITE_FAILED: 502,
    ErrorCode.INTERNAL_ERROR: 500,
}

ERROR_MESSAGE: dict[ErrorCode, str] = {
    ErrorCode.INVALID_REQUEST: "요청 형식이 올바르지 않습니다.",
    ErrorCode.MEETING_NOT_FOUND: "해당 회의 세션을 찾을 수 없습니다.",
    ErrorCode.MEETING_ALREADY_ENDED: "이미 종료된 회의 세션입니다.",
    ErrorCode.AUDIO_UPLOAD_FAILED: "오디오 저장·병합에 실패했습니다.",
    ErrorCode.AUDIO_FORMAT_UNSUPPORTED: "지원하지 않는 오디오 형식입니다.",
    ErrorCode.TRANSCRIPTION_FAILED: "음성 전사에 실패했습니다.",
    ErrorCode.EXTRACTION_FAILED: "회의 분석에 실패했습니다.",
    ErrorCode.EXTRACTION_NOT_FOUND: "해당 추출 결과를 찾을 수 없습니다.",
    ErrorCode.APPROVAL_NOT_FOUND: "해당 승인 요청을 찾을 수 없습니다.",
    ErrorCode.NOTION_WRITE_FAILED: "Notion 반영에 실패했습니다.",
    ErrorCode.INTERNAL_ERROR: "서버 내부 오류가 발생했습니다.",
}


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


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

