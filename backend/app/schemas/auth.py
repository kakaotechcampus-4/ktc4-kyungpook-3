import re
import unicodedata
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator

from app.schemas.email import NormalizedEmail

PASSWORD_RULE_MESSAGE = "비밀번호는 8자 이상이고 숫자를 하나 이상 포함해야 합니다."


def validate_password(value: str) -> str:
    # \d 는 유니코드 숫자도 받으므로 ASCII 숫자만 본다.
    if len(value) < 8 or not re.search(r"[0-9]", value):
        raise ValueError(PASSWORD_RULE_MESSAGE)
    return value


NAME_MAX_LENGTH = 100
# 글자 방향 제어 문자(Cf). 이름 뒤의 문장을 거꾸로 보이게 할 수 있어 어디에 있어도 거절한다. ZWJ·ZWNJ 는 허용한다.
_BIDI_CONTROLS = frozenset("\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069")
NAME_RULE_MESSAGE = "이름은 앞뒤 공백을 뺀 1~100자이고 제어문자를 포함할 수 없습니다."


def validate_name(value: str) -> str:
    value = value.strip()
    # 길이를 먼저 본다. 아주 긴 이름의 글자 범주를 구하기 전에 거절한다.
    if not value or len(value) > NAME_MAX_LENGTH:
        raise ValueError(NAME_RULE_MESSAGE)
    has_visible = False
    for ch in value:
        category = unicodedata.category(ch)
        if category in ("Cc", "Cs", "Zl", "Zp") or ch in _BIDI_CONTROLS:
            raise ValueError(NAME_RULE_MESSAGE)
        # strip 은 양 끝의 형식 문자(Cf)에서 멈추므로, 안쪽에 공백(Z*)이 남아도 보이는 글자가 없으면 막는다.
        # 결합 부호(Mn)·둘러싸는 부호(Me)는 글자 뒤에 붙어야 보이므로, 이것만 있는 이름도 빈칸으로 본다.
        if not (category in ("Cf", "Mn", "Me") or category.startswith("Z")):
            has_visible = True
    if not has_visible:
        raise ValueError(NAME_RULE_MESSAGE)
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
    name: str

    @field_validator("password")
    @classmethod
    def _check_password(cls, value: str) -> str:
        return validate_password(value)

    @field_validator("name")
    @classmethod
    def _check_name(cls, value: str) -> str:
        return validate_name(value)


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
