"""add meeting_audio

회의 하나의 재생용 녹음 기록 표(#659). 보관 기간은 received_at(녹음이 BE 에 들어온 시각)부터 센다.
기존 회의에는 행을 만들지 않는다. 이전 녹음은 처리가 끝나면 이미 지워졌기 때문이다.

Revision ID: c7a1e4d92b35
Revises: b20d029aec7b
Create Date: 2026-11-10 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7a1e4d92b35'
down_revision: Union[str, Sequence[str], None] = 'b20d029aec7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'meeting_audio',
        sa.Column('meeting_id', sa.String(length=36), nullable=False),
        sa.Column('filename', sa.String(length=32), nullable=False),
        sa.Column('content_type', sa.String(length=64), nullable=False),
        sa.Column('size_bytes', sa.BigInteger(), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['meeting_id'], ['meeting.meeting_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('meeting_id'),
    )


def downgrade() -> None:
    op.drop_table('meeting_audio')
