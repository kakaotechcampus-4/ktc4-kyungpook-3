"""integration discord guild unique

Discord 연결(integration, provider='discord')의 provider_channel_id에는 연결한 서버(guild) ID가 들어간다(#171).
한 서버는 한 워크스페이스에만 연결하도록 부분 유일 인덱스를 건다. 다른 제공자(Notion은 대상 DB ID)와
서버 ID가 비어 있는 행은 걸리지 않는다.

Revision ID: a2c7e5d91b48
Revises: f1d6a3c8e275
Create Date: 2026-10-07 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2c7e5d91b48'
down_revision: Union[str, Sequence[str], None] = 'f1d6a3c8e275'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_index(
        'uq_integration_discord_guild', 'integration', ['provider_channel_id'],
        unique=True, postgresql_where=sa.text("provider = 'discord'"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        'uq_integration_discord_guild', table_name='integration',
        postgresql_where=sa.text("provider = 'discord'"),
    )
