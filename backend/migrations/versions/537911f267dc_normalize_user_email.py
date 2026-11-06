"""normalize user.email

가입·로그인·재설정 요청의 이메일을 소문자로 정규화하기로 하면서(#434), 이미 저장된
user.email 도 같은 규칙(앞뒤 공백 제거 + 소문자)으로 바꾼다.

소문자로 같아지는 계정이 둘 이상이면 아무 행도 바꾸지 않고 RuntimeError 로 멈춘다.
오류에는 user_id 묶음만 담고 이메일 주소는 넣지 않는다. 중복을 먼저 모두 검사한 뒤에만
UPDATE 를 시작하므로 sqlite 처럼 DDL 트랜잭션이 없는 곳에서도 부분 변경이 남지 않는다.

배포 전 운영 서버에서 확인할 것(읽기 전용, 이메일·user_id 는 출력하지 않는다). 마이그레이션과 같은
규칙(strip().lower())으로 세므로 "duplicate groups" 가 0 이어야 컨테이너 시작 때 멈추지 않는다.
"rows to change" 는 바뀔 행 수다. 저장소 루트에서:

    docker compose -f backend/docker-compose.prod.yml exec api python -c 'import os,collections,sqlalchemy as sa;c=sa.create_engine(os.environ["DATABASE_URL"]).connect();g=collections.Counter();r=c.execute(sa.select(sa.table("user", sa.column("email")))).all();[g.update([m.strip().lower()]) for (m,) in r];print("duplicate groups:",sum(v>1 for v in g.values()),"rows to change:",sum(m.strip().lower()!=m for (m,) in r))'

보조로 SQL 두 개를 쓸 수 있으나 ASCII·공백만 다루는 근사치다. btrim 은 공백만 지우고 PostgreSQL lower 는
DB 로케일에 따라 Python str.lower() 와 다를 수 있어, 0 이어도 위 Python 확인이 0 이 아닐 수 있다:
    SELECT count(*) FROM (SELECT lower(btrim(email)) FROM "user" GROUP BY 1 HAVING count(*) > 1) d;
    SELECT count(*) FROM "user" WHERE email <> lower(btrim(email));

되돌릴 수 없다. 원래 대소문자는 저장하지 않으므로 downgrade 는 아무것도 하지 않는다.

Revision ID: 537911f267dc
Revises: a3d7f91c5e28
Create Date: 2026-11-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '537911f267dc'
down_revision: Union[str, Sequence[str], None] = 'a3d7f91c5e28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _normalize(email: str) -> str:
    # app.schemas.email.normalize_email 과 같아야 한다. 마이그레이션은 앱 코드가 바뀌어도 그대로여야 해서 복제한다.
    return email.strip().lower()


def upgrade() -> None:
    """저장된 이메일을 정규화한다. 소문자로 같아지는 계정이 있으면 아무것도 바꾸지 않고 멈춘다."""
    conn = op.get_bind()
    rows = conn.execute(sa.text('SELECT user_id, email FROM "user"')).all()

    groups: dict[str, list[str]] = {}
    for user_id, email in rows:
        groups.setdefault(_normalize(email), []).append(user_id)
    duplicates = sorted(sorted(ids) for ids in groups.values() if len(ids) > 1)
    if duplicates:
        raise RuntimeError(
            "소문자로 같아지는 계정이 있어 이메일을 바꾸지 않았습니다. "
            f"정리할 user_id 묶음: {duplicates}"
        )

    for user_id, email in rows:
        normalized = _normalize(email)
        if normalized != email:
            conn.execute(
                sa.text('UPDATE "user" SET email = :e WHERE user_id = :id'),
                {"e": normalized, "id": user_id},
            )


def downgrade() -> None:
    """원래 대소문자를 알 수 없어 되돌리지 않는다."""
