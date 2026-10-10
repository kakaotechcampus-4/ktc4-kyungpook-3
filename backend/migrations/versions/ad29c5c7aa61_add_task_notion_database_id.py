"""add task notion database id

Task가 Notion 어느 DB의 페이지에 반영됐는지 기록하는 컬럼을 추가한다(#192).
연결된 DB가 바뀌면 워커가 이 값과 비교해 옛 페이지 대신 새 DB에 페이지를 새로 만든다.
이미 반영된 Task(notion_page_id 있음)는 지금 연결된 DB의 페이지이므로 그 DB ID로 채운다.
채우지 않으면 다음 반영 때 워커가 DB가 다르다고 보고 같은 DB에 페이지를 한 번 더 만든다.
연동을 끊어 연결 행이 없는 워크스페이스는 채울 값이 없어 NULL로 둔다.

Revision ID: ad29c5c7aa61
Revises: a2c7e5d91b48
Create Date: 2026-10-11 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ad29c5c7aa61'
down_revision: Union[str, Sequence[str], None] = 'a2c7e5d91b48'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('task', sa.Column('notion_database_id', sa.String(length=64), nullable=True))
    op.execute(sa.text(
        """
        UPDATE task SET notion_database_id = (
            SELECT integration.provider_channel_id FROM integration
            WHERE integration.workspace_id = task.workspace_id AND integration.provider = 'notion'
        )
        WHERE notion_page_id IS NOT NULL
        """
    ))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('task', 'notion_database_id')
