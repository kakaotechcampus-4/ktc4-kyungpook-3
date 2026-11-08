import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

from app.schemas.email import NormalizedEmail
from app.schemas.name import NameStr

PASSWORD_RULE_MESSAGE = "비밀번호는 8자 이상이고 숫자를 하나 이상 포함해야 합니다."


def validate_password(value: str) -> str:
    # \d 는 유니코드 숫자도 받으므로 ASCII 숫자만 본다.
    if len(value) < 8 or not re.search(r"[0-9]", value):
        raise ValueError(PASSWORD_RULE_MESSAGE)
    return value


class UserResponse(BaseModel):
    user_id: str
    email: str
    name: str
    avatar_url: Optional[str] = None

class AuthResponse(BaseModel):
    user: UserResponse
    workspace_count: int
    last_workspace_id: Optional[str] = None

class LoginRequest(BaseModel):
    email: NormalizedEmail
    password: str

class SignupRequest(BaseModel):
    email: NormalizedEmail
    password: str
    name: NameStr

    @field_validator("password")
    @classmethod
    def _check_password(cls, value: str) -> str:
        return validate_password(value)


class PasswordResetRequest(BaseModel):
    email: NormalizedEmail


class PasswordResetVerifyRequest(BaseModel):
    token: str


class PasswordResetConfirmRequest(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def _check_password(cls, value: str) -> str:
        return validate_password(value)


class PasswordResetVerifyResponse(BaseModel):
    expires_at: datetime
    email_masked: str
