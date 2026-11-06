"""add workspace message settings

워크스페이스별 메시지·알림 설정(#339). 행이 없으면 서비스가 기본값으로 본다.

되돌리면 workspace_message_settings 테이블과 저장된 설정이 지워진다.

Revision ID: c4e9a71b3d52
Revises: 8b3090f39aec
Create Date: 2026-11-04 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e9a71b3d52'
down_revision: Union[str, Sequence[str], None] = '8b3090f39aec'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'workspace_message_settings',
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('due_reminder', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('minutes_summary', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('silence_alert', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.Column('nudge_days_before', sa.Integer(), server_default=sa.text('1'), nullable=False),
        sa.Column('nudge_hour', sa.Integer(), server_default=sa.text('9'), nullable=False),
        sa.Column('pm_alert_method', sa.String(length=16), server_default='both', nullable=False),
        sa.Column('reminder_auto_approve', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.Column('auto_approve_since', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_by', sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(['updated_by'], ['member.member_id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspace.workspace_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('workspace_id'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('workspace_message_settings')
