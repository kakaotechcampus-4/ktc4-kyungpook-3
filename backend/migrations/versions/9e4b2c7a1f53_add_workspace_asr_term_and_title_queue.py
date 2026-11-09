"""add workspace asr term and title queue

워크스페이스 용어 목록(workspace_asr_term)과 승인 제목 큐(asr_title_queue)를 더한다(#532).
AI 가 새 할 일 제목의 명사 중 용어 목록에 없는 말을 전사 오인식 의심 단어로 본다.
PM 이 task_create 승인으로 만든 태스크의 최종 제목을 큐에 쌓고, AI 가 받아 명사를 목록에 올린 뒤 지운다.

되돌리면 두 테이블과 쌓인 용어·제목이 지워진다.

Revision ID: 9e4b2c7a1f53
Revises: 7536c5a1a471
Create Date: 2026-11-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9e4b2c7a1f53'
down_revision: Union[str, Sequence[str], None] = '7536c5a1a471'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'workspace_asr_term',
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('word', sa.String(length=30), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspace.workspace_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('workspace_id', 'word'),
    )
    op.create_table(
        'asr_title_queue',
        sa.Column('title_id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('title', sa.String(length=300), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspace.workspace_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('title_id'),
    )
    op.create_index(op.f('ix_asr_title_queue_workspace_id'), 'asr_title_queue', ['workspace_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_asr_title_queue_workspace_id'), table_name='asr_title_queue')
    op.drop_table('asr_title_queue')
    op.drop_table('workspace_asr_term')
