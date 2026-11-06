"""add integration chat channel

디스코드 연동 행에 채팅 수집 채널(#428)을 둔다. 둘 다 비어 있으면 수집하지 않는다.

되돌리면 저장된 채팅 채널 설정이 지워진다.

Revision ID: fe08fcbd6dc6
Revises: a3d7f91c5e28
Create Date: 2026-11-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fe08fcbd6dc6'
down_revision: Union[str, Sequence[str], None] = 'a3d7f91c5e28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('integration', sa.Column('chat_channel_id', sa.String(length=32), nullable=True))
    op.add_column('integration', sa.Column('chat_channel_name', sa.String(length=100), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('integration', 'chat_channel_name')
    op.drop_column('integration', 'chat_channel_id')
