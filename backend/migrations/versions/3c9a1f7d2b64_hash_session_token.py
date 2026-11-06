"""hash session token

세션 토큰을 원문 대신 sha256 해시로 저장하기로 하면서(#437), 이미 저장된 session.session_token 을
같은 해시로 바꾸고 컬럼 이름을 token_hash(String(64))로 고친다. 해시는 앱의 hash_session_token 과
같은 hashlib.sha256(raw.encode("utf-8", "surrogatepass")).hexdigest() 이며, 마이그레이션이 앱 코드
변경에 묶이지 않도록 앱을 import 하지 않고 직접 계산한다. 이미 로그인한 사용자의 쿠키(원문)는
그대로 유효하다.

배포 전 운영 서버에서 확인할 것(읽기 전용, 토큰 값은 출력하지 않는다). 해시는 항상 64자라 원문 길이와
무관하게 들어가지만, 발급 코드는 43자 토큰만 만드므로 max length 가 64 를 넘으면 다른 경로로 만들어진
행이 있다는 뜻이다. 그러면 머지를 멈추고 확인한다. 저장소 루트에서:

    docker compose -f backend/docker-compose.prod.yml exec api python -c 'import os,sqlalchemy as sa;c=sa.create_engine(os.environ["DATABASE_URL"]).connect();print("rows:",c.execute(sa.text("select count(*) from session")).scalar(),"max length:",c.execute(sa.text("select max(length(session_token)) from session")).scalar())'

되돌릴 수 없다. 해시에서 원문을 복원할 수 없으므로 downgrade 는 모든 세션을 지우고 컬럼 모양만
되돌린다(모든 사용자가 다시 로그인해야 한다).

Revision ID: 3c9a1f7d2b64
Revises: 537911f267dc
Create Date: 2026-11-06 15:00:00.000000

"""
import hashlib
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3c9a1f7d2b64'
down_revision: Union[str, Sequence[str], None] = '537911f267dc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _hash(raw: str) -> str:
    # app.services.sessions.hash_session_token 과 같아야 한다. 앱 코드가 바뀌어도 이 마이그레이션은 그대로여야 해서 복제한다.
    return hashlib.sha256(raw.encode("utf-8", "surrogatepass")).hexdigest()


def upgrade() -> None:
    """저장된 원문 토큰을 sha256 해시로 바꾸고 컬럼·인덱스 이름을 token_hash 로 고친다."""
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT session_id, session_token FROM session")).all()
    params = [{"h": _hash(token), "id": session_id} for session_id, token in rows]
    if params:
        conn.execute(sa.text("UPDATE session SET session_token = :h WHERE session_id = :id"), params)

    op.drop_index("ix_session_session_token", table_name="session")
    with op.batch_alter_table("session") as batch_op:
        batch_op.alter_column(
            "session_token",
            new_column_name="token_hash",
            existing_type=sa.String(length=255),
            type_=sa.String(length=64),
            existing_nullable=False,
        )
    op.create_index("ix_session_token_hash", "session", ["token_hash"], unique=True)


def downgrade() -> None:
    """해시에서 원문을 알 수 없어 모든 세션을 지우고 컬럼을 session_token 으로 되돌린다."""
    op.execute("DELETE FROM session")
    op.drop_index("ix_session_token_hash", table_name="session")
    with op.batch_alter_table("session") as batch_op:
        batch_op.alter_column(
            "token_hash",
            new_column_name="session_token",
            existing_type=sa.String(length=64),
            type_=sa.String(length=255),
            existing_nullable=False,
        )
    op.create_index("ix_session_session_token", "session", ["session_token"], unique=True)
