"""로그인이 비밀번호 재설정(confirm)과 겹쳐도 옛 비밀번호 세션이 남지 않게 사용자 행을 공유 잠금으로 읽는다(#356 리뷰)."""
from sqlalchemy.dialects import postgresql

from app.api import auth


def test_login_reads_the_user_row_with_a_share_lock():
    """잠금 없이 옛 해시를 읽으면, confirm 이 세션을 지운 뒤 뒤늦게 들어온 로그인 세션이 7일 동안 남는다.

    sqlite 는 행 잠금이 없어 동작으로는 볼 수 없으므로 PostgreSQL 로 컴파일한 SQL 로 확인한다.
    """
    sql = str(auth._login_user_stmt("a@b.c").compile(dialect=postgresql.dialect()))

    assert "FOR SHARE" in sql
    assert "FOR UPDATE" not in sql
