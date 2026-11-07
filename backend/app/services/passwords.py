import hashlib
import hmac
import secrets

_PBKDF2_ITERATIONS = 260_000

# 없는 계정·비밀번호 없는 계정도 verify_password 를 한 번 거치게 하는 자리 채움 값. 어떤 입력과도 맞지 않는다.
DUMMY_PASSWORD_HASH = "00" * 16 + "$" + "00" * 32


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ITERATIONS)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, digest_hex = stored_hash.split("$", 1)
    except ValueError:
        return False
    # 짝 없는 서로게이트도 JSON 을 통과하므로 surrogatepass 로 인코딩해 500 대신 불일치로 처리한다.
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8", "surrogatepass"), bytes.fromhex(salt), _PBKDF2_ITERATIONS
    )
    return hmac.compare_digest(digest.hex(), digest_hex)
