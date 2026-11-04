"""add speaker assignment

수동 업로드 화자 지정(#266)에 쓰는 meeting_upload 컬럼 5개를 더한다. 모두 nullable 이라 기존 행은 그대로 둔다.

Revision ID: 5c1f0a7e93b2
Revises: 2862514e7dbd
Create Date: 2026-11-02 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5c1f0a7e93b2'
down_revision: Union[str, Sequence[str], None] = '2862514e7dbd'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('meeting_upload', sa.Column('speakers', sa.Text(), nullable=True))
    op.add_column('meeting_upload', sa.Column('speakers_reported_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('meeting_upload', sa.Column('speaker_mapping', sa.Text(), nullable=True))
    op.add_column('meeting_upload', sa.Column('speakers_assigned_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('meeting_upload', sa.Column('resumed_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('meeting_upload', 'resumed_at')
    op.drop_column('meeting_upload', 'speakers_assigned_at')
    op.drop_column('meeting_upload', 'speaker_mapping')
    op.drop_column('meeting_upload', 'speakers_reported_at')
    op.drop_column('meeting_upload', 'speakers')
