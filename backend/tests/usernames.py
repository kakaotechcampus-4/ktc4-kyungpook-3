"""테스트 사용자의 아이디. 이메일이 다르면 아이디도 달라서 한 테스트가 여러 계정을 만들어도 겹치지 않는다."""
import hashlib


def username_for(email: str) -> str:
    # 아이디 규칙(영문 소문자·숫자 4~20자)을 지키는 16자. PostgreSQL 은 String(20) 을 넘으면 거절한다.
    return "u" + hashlib.sha256(email.encode()).hexdigest()[:15]
