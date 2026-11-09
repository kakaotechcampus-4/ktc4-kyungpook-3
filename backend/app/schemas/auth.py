import re
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.email import NormalizedEmail
from app.schemas.name import NameStr
from app.schemas.username import UsernameStr

PASSWORD_RULE_MESSAGE = "비밀번호는 8자 이상이고 숫자를 하나 이상 포함해야 합니다."


def validate_password(value: str) -> str:
    # \d 는 유니코드 숫자도 받으므로 ASCII 숫자만 본다.
    if len(value) < 8 or not re.search(r"[0-9]", value):
        raise ValueError(PASSWORD_RULE_MESSAGE)
    return value


class UserResponse(BaseModel):
    user_id: str
    username: str
    email: Optional[str] = None
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
    """이메일 가입은 증명 토큰의 인증된 이메일과 비밀번호로 만든다. 본문의 이메일은 읽지 않는다.
    카카오 가입(link_kakao)은 대기 쿠키의 카카오 신원만으로 만들고 비밀번호·이메일을 두지 않는다(#610)."""

    verification_token: Optional[str] = None
    password: Optional[str] = None
    name: NameStr
    username: UsernameStr
    link_kakao: bool = False

    @field_validator("password")
    @classmethod
    def _check_password(cls, value: Optional[str]) -> Optional[str]:
        return None if value is None else validate_password(value)

    @model_validator(mode="after")
    def _check_signup_kind(self) -> "SignupRequest":
        if self.link_kakao:
            if self.password is not None or self.verification_token is not None:
                raise ValueError("카카오 가입은 비밀번호와 이메일 인증 토큰을 받지 않습니다.")
        elif self.password is None:
            raise ValueError("이메일 가입은 비밀번호가 필요합니다.")
        return self


class KakaoPendingResponse(BaseModel):
    email: Optional[str] = None
    nickname: Optional[str] = None


class SignupCodeRequest(BaseModel):
    email: NormalizedEmail


class SignupCodeResponse(BaseModel):
    expires_in: int
    resend_after: int


class SignupCodeConfirmRequest(BaseModel):
    email: NormalizedEmail
    code: str = Field(pattern=r"^[0-9]{6}$")


class SignupCodeConfirmResponse(BaseModel):
    verification_token: str
    expires_in: int


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
