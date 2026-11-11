"""비밀번호 해시 형식과 반복 횟수(#691). 새 해시는 횟수를 담고, 횟수를 담지 않은 옛 해시도 맞춰 본다."""
import hashlib

from app.services import passwords
from app.services.passwords import dummy_password_hash, hash_password, needs_rehash, verify_password

PW = "rightpass123"


def _legacy_hash(password: str) -> str:
    """#691 이전 형식 `salt$digest`(260,000회)."""
    salt = "ab" * 16
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 260_000)
    return f"{salt}${digest.hex()}"


def test_new_hash_stores_scheme_and_600k_iterations():
    stored = hash_password(PW)

    scheme, iterations, salt, digest = stored.split("$")
    assert (scheme, iterations) == ("pbkdf2_sha256", "600000")
    assert len(salt) == 32 and len(digest) == 64
    assert verify_password(PW, stored)
    assert not verify_password("wrongpass123", stored)
    assert not needs_rehash(stored)


def test_legacy_hash_still_verifies_and_needs_rehash():
    stored = _legacy_hash(PW)

    assert verify_password(PW, stored)
    assert not verify_password("wrongpass123", stored)
    assert needs_rehash(stored)


def test_legacy_hash_costs_as_much_as_a_new_hash(monkeypatch):
    """옛 해시도 지금 횟수만큼 계산해, 응답 시간으로 옛 해시 계정(가입한 계정)이 드러나지 않게 한다."""
    stored = _legacy_hash(PW)
    rounds = []
    real = hashlib.pbkdf2_hmac

    def counting(name, password, salt, iterations, *args):
        rounds.append(iterations)
        return real(name, password, salt, iterations, *args)

    monkeypatch.setattr(hashlib, "pbkdf2_hmac", counting)

    verify_password("wrongpass123", stored)

    assert sum(rounds) == passwords._PBKDF2_ITERATIONS


def test_dummy_hash_uses_the_current_iterations_and_matches_nothing(monkeypatch):
    assert dummy_password_hash().split("$")[1] == "600000"
    assert not verify_password("", dummy_password_hash())
    monkeypatch.setattr(passwords, "_PBKDF2_ITERATIONS", 1)
    assert dummy_password_hash().split("$")[1] == "1"


def test_malformed_hashes_do_not_verify():
    for stored in ("", "abc", "pbkdf2_sha256$x$00$00", "other$600000$00$00", "a$b$c"):
        assert not verify_password(PW, stored)
