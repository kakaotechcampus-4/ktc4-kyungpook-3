"""add workspace onboarding step

워크스페이스별 온보딩 단계 상태(workspace_onboarding_step)를 추가한다(#131).
행이 없는 단계는 기본값(create_workspace는 completed, 나머지는 pending)으로 읽으므로,
기존 워크스페이스 중 onboarding_completed가 true인 곳만 네 단계를 completed로 채운다.

Revision ID: c4f19a2d7e83
Revises: c4f2a8e61b93
Create Date: 2026-10-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4f19a2d7e83'
down_revision: Union[str, Sequence[str], None] = 'c4f2a8e61b93'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STEPS = ('create_workspace', 'connect_discord', 'connect_notion', 'connect_members')


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('workspace_onboarding_step',
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('step', sa.String(length=32), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspace.workspace_id'], name=op.f('fk_workspace_onboarding_step_workspace_id_workspace'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('workspace_id', 'step', name=op.f('pk_workspace_onboarding_step'))
    )

    for step in STEPS:
        op.execute(
            "INSERT INTO workspace_onboarding_step (workspace_id, step, status, updated_at) "
            f"SELECT workspace_id, '{step}', 'completed', CURRENT_TIMESTAMP "
            "FROM workspace WHERE onboarding_completed IS TRUE"
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('workspace_onboarding_step')
