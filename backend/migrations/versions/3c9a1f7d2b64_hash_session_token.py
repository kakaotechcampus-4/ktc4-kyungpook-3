"""hash session token

세션 토큰을 원문 대신 sha256 해시로 저장하기로 하면서(#437), 이미 저장된 session.session_token 값을
같은 해시로 바꾼다. 컬럼 이름(session_token)·길이(255)·인덱스(ix_session_session_token)는 그대로여서
스키마 변경(DDL)은 없고 데이터만 바꾼다. 해시는 앱의 hash_session_token 과 같은
hashlib.sha256(raw.encode("utf-8", "surrogatepass")).hexdigest() 이며, 마이그레이션이 앱 코드 변경에
묶이지 않도록 앱을 import 하지 않고 직접 계산한다. 마이그레이션은 한 번만 돌므로 모든 행을 정확히 한 번
해시한다. 이미 로그인한 사용자의 쿠키(원문)는 그대로 유효하다.

되돌릴 수 없다. 해시에서 원문을 복원할 수 없으므로 downgrade 는 모든 세션을 지운다(모든 사용자가 다시
로그인해야 한다). 코드만 되돌리면(스키마가 같아 500 은 나지 않는다) 옛 코드가 쿠키 원문을 저장된 해시와
비교해 일치하지 않으므로 401 이 되고, 모든 사용자가 다시 로그인한다.

배포 전 운영 서버에서 확인할 것(읽기 전용, 토큰 값은 출력하지 않는다). 해시는 항상 64자라 원문 길이와
무관하게 들어간다. 저장소 루트에서:

    docker compose -f backend/docker-compose.prod.yml exec api python -c 'import os,sqlalchemy as sa;c=sa.create_engine(os.environ["DATABASE_URL"]).connect();print("rows:",c.execute(sa.text("select count(*) from session")).scalar(),"max length:",c.execute(sa.text("select max(length(session_token)) from session")).scalar())'

Revision ID: 3c9a1f7d2b64
Revises: 1032faab5855
Create Date: 2026-11-06 15:00:00.000000

"""
import hashlib
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3c9a1f7d2b64'
down_revision: Union[str, Sequence[str], None] = '1032faab5855'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


BATCH = 1000


def _hash(raw: str) -> str:
    # app.services.sessions.hash_session_token 과 같아야 한다. 앱 코드가 바뀌어도 이 마이그레이션은 그대로여야 해서 복제한다.
    return hashlib.sha256(raw.encode("utf-8", "surrogatepass")).hexdigest()


def upgrade() -> None:
    """저장된 원문 토큰을 sha256 해시로 바꾼다. 컬럼·인덱스는 그대로다(스키마 변경 없음)."""
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT session_id, session_token FROM session")).all()
    update = sa.text("UPDATE session SET session_token = :h WHERE session_id = :id")
    for start in range(0, len(rows), BATCH):
        chunk = rows[start : start + BATCH]
        conn.execute(update, [{"h": _hash(token), "id": session_id} for session_id, token in chunk])


def downgrade() -> None:
    """해시에서 원문을 알 수 없어 모든 세션을 지운다. 스키마는 그대로다."""
    op.execute("DELETE FROM session")
