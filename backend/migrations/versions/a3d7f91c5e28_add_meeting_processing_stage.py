"""add meeting processing_stage

Revision ID: a3d7f91c5e28
Revises: a7c3e91d5b24
Create Date: 2026-11-05 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a3d7f91c5e28'
down_revision: Union[str, None] = 'a7c3e91d5b24'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('meeting', sa.Column('processing_stage', sa.String(length=16), nullable=True))
    op.add_column(
        'meeting', sa.Column('processing_stage_at', sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('meeting', 'processing_stage_at')
    op.drop_column('meeting', 'processing_stage')
