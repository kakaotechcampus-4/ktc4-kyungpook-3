"""backfill member name aliases

팀원 이름에서 담당자 별칭을 자동으로 만들기로 하면서(#459), 이미 있는 팀원에게도 같은 규칙으로
source=display_name 별칭을 채운다. 스키마는 바꾸지 않는 데이터 마이그레이션이다.

규칙은 앱의 member_aliases.sync_name_aliases 와 같다. 탈퇴하지 않은 팀원의 이름이 한글 두 글자 이상이면
[전체 이름, 성 뗀 이름] 을 alias_type=realname, verified=True, confidence=1.0 으로 넣는다. 다음 경우는 넣지 않는다.
- 같은 팀원에게 같은 글자의 별칭이 이미 있다(출처 무관).
- 같은 워크스페이스의 탈퇴하지 않은 다른 팀원이 같은 글자를 manual·learned 로 갖고 있다.
자동끼리(display_name·discord_profile) 겹치는 글자는 둘 다 넣어 매칭이 ambiguous 가 되게 한다.
이미 있는 별칭은 건너뛰므로 여러 번 돌려도 중복이 생기지 않는다.

downgrade 는 source=display_name 별칭을 모두 지운다. 이 마이그레이션 전에 있던 display_name 별칭은
없었으므로(앱이 이 값을 쓰기 시작한 것이 같은 변경이다) 되돌려도 다른 별칭은 남는다.

Revision ID: 1032faab5855
Revises: b0d32ee4abcb
Create Date: 2026-11-06 15:00:00.000000

"""
import re
import uuid
from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1032faab5855'
down_revision: Union[str, Sequence[str], None] = 'b0d32ee4abcb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SOURCE = "display_name"
# 같은 글자를 이 출처가 다른 팀원에게 있으면 자동 별칭을 넣지 않는다.
_BLOCKING_SOURCES = ("manual", "learned")

_member = sa.table(
    "member",
    sa.column("member_id", sa.String),
    sa.column("workspace_id", sa.String),
    sa.column("display_name", sa.String),
    sa.column("is_deleted", sa.Boolean),
)
_alias = sa.table(
    "member_alias",
    sa.column("alias_id", sa.String),
    sa.column("member_id", sa.String),
    sa.column("workspace_id", sa.String),
    sa.column("alias_text", sa.String),
    sa.column("alias_type", sa.String),
    sa.column("source", sa.String),
    sa.column("confidence", sa.Float),
    sa.column("verified", sa.Boolean),
    sa.column("created_at", sa.DateTime(timezone=True)),
)


def _forms(name: str | None) -> list[str]:
    # 앱 app.services.member_aliases.name_alias_forms 와 같게 한다. 마이그레이션은 앱 코드가 바뀌어도
    # 그대로여야 해서 복제하고, 같은 결과인지는 테스트가 비교한다.
    stripped = (name or "").strip()
    if not re.fullmatch(r"[가-힣]{2,}", stripped):
        return []
    given = stripped[2:] if len(stripped) == 4 else stripped[1:]
    return [stripped, given]


def upgrade() -> None:
    """탈퇴하지 않은 팀원마다 이름 별칭을 채운다. 이미 있거나 다른 팀원의 사람이 정한 별칭과 겹치면 건너뛴다."""
    conn = op.get_bind()
    members = conn.execute(
        sa.select(_member.c.member_id, _member.c.workspace_id, _member.c.display_name).where(
            _member.c.is_deleted.is_(False)
        )
    ).all()

    # (member_id, 글자) 쌍: 그 팀원이 이미 가진 별칭.
    own: set[tuple[str, str]] = set()
    # (workspace_id, 글자) -> 탈퇴하지 않은 팀원 중 manual·learned 로 가진 팀원 id.
    human_owners: dict[tuple[str, str], set[str]] = {}
    active_ids = {member_id for member_id, _, _ in members}
    for member_id, workspace_id, alias_text, source in conn.execute(
        sa.select(_alias.c.member_id, _alias.c.workspace_id, _alias.c.alias_text, _alias.c.source)
    ):
        own.add((member_id, alias_text))
        if source in _BLOCKING_SOURCES and member_id in active_ids:
            human_owners.setdefault((workspace_id, alias_text), set()).add(member_id)

    now = datetime.now(timezone.utc)
    rows = []
    for member_id, workspace_id, display_name in members:
        for text in _forms(display_name):
            if (member_id, text) in own:
                continue
            if human_owners.get((workspace_id, text), set()) - {member_id}:
                continue
            rows.append(
                {
                    "alias_id": str(uuid.uuid4()),
                    "member_id": member_id,
                    "workspace_id": workspace_id,
                    "alias_text": text,
                    "alias_type": "realname",
                    "source": _SOURCE,
                    "confidence": 1.0,
                    "verified": True,
                    "created_at": now,
                }
            )
    if rows:
        conn.execute(sa.insert(_alias), rows)


def downgrade() -> None:
    """source=display_name 별칭만 지운다. manual·learned·discord_profile 별칭은 그대로 둔다."""
    op.get_bind().execute(sa.delete(_alias).where(_alias.c.source == _SOURCE))
