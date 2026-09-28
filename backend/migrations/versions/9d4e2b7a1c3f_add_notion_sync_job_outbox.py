"""add notion sync job outbox and task sync columns

Revision ID: 9d4e2b7a1c3f
Revises: c643735a770a
Create Date: 2026-09-25 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9d4e2b7a1c3f'
down_revision: Union[str, Sequence[str], None] = 'c643735a770a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('task', schema=None) as batch_op:
        batch_op.add_column(sa.Column('version', sa.Integer(), server_default='1', nullable=False))
        batch_op.add_column(sa.Column('notion_synced_version', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('notion_sync_status', sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column('notion_create_attempted_at', sa.DateTime(timezone=True), nullable=True))

    # 기존 방식(요청 안에서 동기 호출)으로 이미 페이지가 만들어진 Task는 반영된 것으로 본다.
    op.execute(
        "UPDATE task SET notion_synced_version = 1, notion_sync_status = 'synced' "
        "WHERE notion_page_id IS NOT NULL"
    )

    op.create_table('notion_sync_job',
    sa.Column('job_id', sa.String(length=36), nullable=False),
    sa.Column('task_id', sa.String(length=36), nullable=False),
    sa.Column('task_version', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('attempts', sa.Integer(), nullable=False),
    sa.Column('next_attempt_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('locked_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['task_id'], ['task.task_id'], name=op.f('fk_notion_sync_job_task_id_task'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('job_id', name=op.f('pk_notion_sync_job')),
    sa.UniqueConstraint('task_id', 'task_version', name='uq_notion_sync_job_task_version')
    )
    with op.batch_alter_table('notion_sync_job', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_notion_sync_job_task_id'), ['task_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_notion_sync_job_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_notion_sync_job_next_attempt_at'), ['next_attempt_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('notion_sync_job', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_notion_sync_job_next_attempt_at'))
        batch_op.drop_index(batch_op.f('ix_notion_sync_job_status'))
        batch_op.drop_index(batch_op.f('ix_notion_sync_job_task_id'))

    op.drop_table('notion_sync_job')

    with op.batch_alter_table('task', schema=None) as batch_op:
        batch_op.drop_column('notion_create_attempted_at')
        batch_op.drop_column('notion_sync_status')
        batch_op.drop_column('notion_synced_version')
        batch_op.drop_column('version')
