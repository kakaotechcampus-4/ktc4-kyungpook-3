"""add meeting processing_stt_done, processing_stt_total

Revision ID: d6e1b4a8c297
Revises: a7c25d91e4f3
Create Date: 2026-11-08 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd6e1b4a8c297'
down_revision: Union[str, None] = 'a7c25d91e4f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('meeting', sa.Column('processing_stt_done', sa.Integer(), nullable=True))
    op.add_column('meeting', sa.Column('processing_stt_total', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('meeting', 'processing_stt_total')
    op.drop_column('meeting', 'processing_stt_done')
