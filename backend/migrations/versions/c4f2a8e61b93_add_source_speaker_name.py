"""add source speaker_name

발화를 저장할 때의 디스코드 표시 이름을 source.speaker_name에 남긴다(#129).
팀원과 연결되지 않은 화자도 회의록에서 uid 대신 이름으로 보여 주기 위해서다.

Revision ID: c4f2a8e61b93
Revises: b5d8f03a6c41
Create Date: 2026-10-01 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4f2a8e61b93'
down_revision: Union[str, Sequence[str], None] = 'b5d8f03a6c41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('source', sa.Column('speaker_name', sa.String(length=100), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('source', 'speaker_name')
