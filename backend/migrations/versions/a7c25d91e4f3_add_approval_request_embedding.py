"""add approval request embedding

승인 대기 중인 task_create 요청의 제목 임베딩(#141)과, 임베딩 API가 거절한 제목을 기록하는 컬럼을 추가한다.
기존 row는 NULL로 두고 임베딩 워커가 채운다. 백필과 벡터 인덱스는 만들지 않는다.

Revision ID: a7c25d91e4f3
Revises: 3c9a1f7d2b64
Create Date: 2026-11-07 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector


# revision identifiers, used by Alembic.
revision: str = 'a7c25d91e4f3'
down_revision: Union[str, Sequence[str], None] = '3c9a1f7d2b64'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('approval_request', sa.Column('embedding', Vector(1536), nullable=True))
    op.add_column('approval_request', sa.Column('embedding_rejected_title', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('approval_request', 'embedding_rejected_title')
    op.drop_column('approval_request', 'embedding')
