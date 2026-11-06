from typing import Annotated

from pydantic import AfterValidator, EmailStr


def normalize_email(email: str) -> str:
    """이메일을 비교·저장하는 형태. 대소문자와 앞뒤 공백 차이로 계정이 갈라지거나 못 찾는 일이 없게 한다."""
    return email.strip().lower()


# EmailStr 검사를 통과한 값에 normalize_email 을 적용한다.
NormalizedEmail = Annotated[EmailStr, AfterValidator(normalize_email)]
