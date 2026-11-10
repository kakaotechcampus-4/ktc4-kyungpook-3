"""add user username

모든 계정에 아이디(user.username)를 두고, 카카오만으로 가입한 계정을 위해 user.email 을 비워 둘 수 있게
한다(#610). 아이디는 영문 소문자·숫자 4~20자이고 소문자로 저장하므로 unique 인덱스가 대소문자를 가리지 않는
유일성을 지킨다.

이미 있는 계정의 아이디는 이메일 앞부분에서 만든다. 소문자로 바꾸고 영문·숫자만 남긴 뒤, 4자보다 짧으면 앞에
user 를 붙이고(비면 user), 20자로 자른다. 같은 값이 이미 있으면 가입 순서(created_at, user_id)대로 뒤에 2, 3, ...
을 붙이고 그만큼 앞을 잘라 20자를 넘지 않게 한다.

downgrade 는 이메일 없는 계정이 하나라도 있으면 아무것도 바꾸지 않고 RuntimeError 로 멈춘다. 지우거나 가짜
이메일을 넣지 않는다. 없으면 username 을 지우고 email 을 다시 필수로 한다. 아이디는 되살리지 않는다.

Revision ID: 950ecd8babeb
Revises: 9e4b2c7a1f53
Create Date: 2026-11-09 12:00:00.000000

"""
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '950ecd8babeb'
down_revision: Union[str, Sequence[str], None] = '9e4b2c7a1f53'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MAX_LENGTH = 20
MIN_LENGTH = 4


def _base(email: str) -> str:
    # app.schemas.username 의 규칙(영문·숫자 4~20자)을 지키는 값. 앱 코드가 바뀌어도 이 마이그레이션은 그대로여야 해서 따로 둔다.
    local = re.sub(r"[^a-z0-9]", "", email.rpartition("@")[0].lower())
    if len(local) < MIN_LENGTH:
        local = "user" + local
    return local[:MAX_LENGTH]


def _backfill(rows: list[tuple[str, str]]) -> dict[str, str]:
    """(user_id, email) 을 가입 순서로 받아 user_id → 아이디. 먼저 가입한 계정이 번호 없는 값을 갖는다."""
    taken: set[str] = set()
    result: dict[str, str] = {}
    for user_id, email in rows:
        base = candidate = _base(email)
        n = 2
        while candidate in taken:
            suffix = str(n)
            candidate = base[: MAX_LENGTH - len(suffix)] + suffix
            n += 1
        taken.add(candidate)
        result[user_id] = candidate
    return result


def upgrade() -> None:
    op.add_column('user', sa.Column('username', sa.String(length=20), nullable=True))
    conn = op.get_bind()
    rows = conn.execute(sa.text('SELECT user_id, email FROM "user" ORDER BY created_at, user_id')).all()
    params = [{"u": username, "id": user_id} for user_id, username in _backfill(rows).items()]
    if params:
        conn.execute(sa.text('UPDATE "user" SET username = :u WHERE user_id = :id'), params)
    # sqlite 는 컬럼 제약을 바꾸지 못해 테이블을 다시 만든다. PostgreSQL 에서는 ALTER 그대로 나간다.
    with op.batch_alter_table('user') as batch:
        batch.alter_column('username', existing_type=sa.String(length=20), nullable=False)
        batch.alter_column('email', existing_type=sa.String(length=255), nullable=True)
        batch.create_index(batch.f('ix_user_username'), ['username'], unique=True)


def downgrade() -> None:
    conn = op.get_bind()
    missing = conn.execute(sa.text('SELECT count(*) FROM "user" WHERE email IS NULL')).scalar_one()
    if missing:
        raise RuntimeError(
            f"이메일 없는 계정 {missing}개가 있어 되돌리지 않았습니다. "
            "email 을 다시 필수로 하려면 이 계정들을 먼저 정리해야 합니다."
        )
    with op.batch_alter_table('user') as batch:
        batch.drop_index(batch.f('ix_user_username'))
        batch.drop_column('username')
        batch.alter_column('email', existing_type=sa.String(length=255), nullable=False)
