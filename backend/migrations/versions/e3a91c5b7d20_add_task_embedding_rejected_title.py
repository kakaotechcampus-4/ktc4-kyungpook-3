"""add task embedding rejected title

임베딩 API가 입력 오류로 거절한 제목을 기록하는 컬럼을 추가한다(#102).
워커는 이 값이 현재 제목과 같은 task를 대상에서 빼서, 거절되는 task가 뒤 task를 막지 않게 한다.
기존 row는 NULL로 둔다.

Revision ID: e3a91c5b7d20
Revises: d8ed8221833e
Create Date: 2026-09-30 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e3a91c5b7d20'
down_revision: Union[str, Sequence[str], None] = 'd8ed8221833e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('task', sa.Column('embedding_rejected_title', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('task', 'embedding_rejected_title')
