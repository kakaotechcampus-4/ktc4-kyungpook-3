"""member discord unique active only

같은 워크스페이스에서 디스코드 계정이 겹치지 않게 하는 제약을 탈퇴하지 않은 팀원(is_deleted=false)에만 건다(#166).
API의 사전 검사는 탈퇴하지 않은 팀원만 보는데 제약은 탈퇴한 팀원까지 봐서, 탈퇴한 사람의 디스코드 계정을
다시 연결하면 사전 검사는 통과하고 DB에서 막혀 500이 났다. 탈퇴 행의 discord_user_id는 기록으로 남긴다.

downgrade는 원래 제약을 되살리므로, 탈퇴한 팀원과 겹치는 디스코드 계정이 생긴 뒤에는 실패한다.

Revision ID: f1d6a3c8e275
Revises: c4f19a2d7e83
Create Date: 2026-10-07 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1d6a3c8e275'
down_revision: Union[str, Sequence[str], None] = 'c4f19a2d7e83'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint('uq_workspace_discord_user', 'member', type_='unique')
    op.create_index(
        'uq_workspace_discord_user', 'member', ['workspace_id', 'discord_user_id'],
        unique=True, postgresql_where=sa.text('is_deleted IS FALSE'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('uq_workspace_discord_user', table_name='member', postgresql_where=sa.text('is_deleted IS FALSE'))
    op.create_unique_constraint('uq_workspace_discord_user', 'member', ['workspace_id', 'discord_user_id'])
