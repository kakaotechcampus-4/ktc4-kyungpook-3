import hashlib
import hmac
import secrets

_SCHEME = "pbkdf2_sha256"
# OWASP 2023 권고(#691). 새 해시는 `pbkdf2_sha256$횟수$salt$digest` 로 횟수를 담는다.
_PBKDF2_ITERATIONS = 600_000
# 횟수를 담지 않은 옛 형식 `salt$digest` 의 횟수. 로그인에 성공하면 지금 횟수로 다시 해시한다.
_LEGACY_ITERATIONS = 260_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ITERATIONS)
    return f"{_SCHEME}${_PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def dummy_password_hash() -> str:
    """없는 계정·비밀번호 없는 계정도 verify_password 를 한 번 거치게 하는 자리 채움 값. 어떤 입력과도 맞지 않는다."""
    return f"{_SCHEME}${_PBKDF2_ITERATIONS}${'00' * 16}${'00' * 32}"


def _parse(stored_hash: str) -> tuple[int, str, str] | None:
    parts = stored_hash.split("$")
    if len(parts) == 2:
        return _LEGACY_ITERATIONS, parts[0], parts[1]
    if len(parts) == 4 and parts[0] == _SCHEME and parts[1].isdigit():
        return int(parts[1]), parts[2], parts[3]
    return None


def needs_rehash(stored_hash: str) -> bool:
    parsed = _parse(stored_hash)
    return parsed is not None and parsed[0] < _PBKDF2_ITERATIONS


def verify_password(password: str, stored_hash: str) -> bool:
    parsed = _parse(stored_hash)
    if parsed is None:
        return False
    iterations, salt, digest_hex = parsed
    # 짝 없는 서로게이트도 JSON 을 통과하므로 surrogatepass 로 인코딩해 500 대신 불일치로 처리한다.
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8", "surrogatepass"), bytes.fromhex(salt), iterations
    )
    if iterations < _PBKDF2_ITERATIONS:
        # 옛 해시도 더미 해시와 같은 횟수만큼 계산해, 응답 시간으로 옛 해시 계정(가입한 계정)이 드러나지 않게 한다.
        hashlib.pbkdf2_hmac("sha256", b"", bytes.fromhex(salt), _PBKDF2_ITERATIONS - iterations)
    return hmac.compare_digest(digest.hex(), digest_hex)
