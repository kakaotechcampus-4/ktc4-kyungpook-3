"""add task embedding vector

task 제목의 임베딩(text-embedding-3-small, 1536차원)을 담는 컬럼을 추가한다(#102).
기존 row는 NULL로 두고 임베딩 워커가 채운다.

Revision ID: 310f56922de3
Revises: 4b7e13b98e39
Create Date: 2026-09-28 04:46:00.412151

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision: str = '310f56922de3'
down_revision: Union[str, Sequence[str], None] = '4b7e13b98e39'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.add_column('task', sa.Column('embedding', Vector(1536), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('task', 'embedding')
    op.execute("DROP EXTENSION IF EXISTS vector")
