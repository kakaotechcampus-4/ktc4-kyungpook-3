import re
from typing import Annotated

from pydantic import AfterValidator

USERNAME_RULE_MESSAGE = "아이디는 영문과 숫자로 된 4~20자여야 합니다."
# 소문자로 바꾸기 전에 본다. 켈빈 기호(K) 같은 글자는 lower() 를 거치면 ASCII 가 된다.
_USERNAME = re.compile(r"[A-Za-z0-9]{4,20}")


def validate_username(value: str) -> str:
    """가입·아이디 변경·중복 확인이 같이 쓰는 규칙. 대소문자를 가리지 않으므로 소문자로 저장·비교한다."""
    value = value.strip()
    if not _USERNAME.fullmatch(value):
        raise ValueError(USERNAME_RULE_MESSAGE)
    return value.lower()


UsernameStr = Annotated[str, AfterValidator(validate_username)]
