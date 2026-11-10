"""소셜 계정 하나는 사용자 하나에만 이어진다(#427)."""
import pytest
from sqlalchemy.exc import IntegrityError

from app.models import User
from tests.usernames import username_for


def test_same_kakao_id_cannot_be_on_two_users(mdb):
    mdb.add(User(username=username_for("a@example.com"), email="a@example.com", name="a", provider="kakao", provider_id="1"))
    mdb.commit()

    mdb.add(User(username=username_for("b@example.com"), email="b@example.com", name="b", provider="kakao", provider_id="1"))
    with pytest.raises(IntegrityError):
        mdb.commit()
    mdb.rollback()


def test_users_without_provider_id_do_not_conflict(mdb):
    mdb.add_all([User(username=username_for(f"{n}@example.com"), email=f"{n}@example.com", name=n, provider="local") for n in "ab"])
    mdb.commit()
