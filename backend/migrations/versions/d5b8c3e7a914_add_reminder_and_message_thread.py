"""add reminder and message thread

PM 이 팀원에게 보내는 마감 리마인드와 그 대화를 저장한다(#310).
message_thread(워크스페이스 x 팀원 한 명의 대화), thread_message(대화에 들어간 메시지: 봇 DM, 팀원 답장),
reminder(태스크 하나 x 수신자 한 명, PM 이 검토하는 단위)를 만든다.

되돌리면 세 테이블과 저장된 리마인드·대화가 모두 지워진다.

Revision ID: d5b8c3e7a914
Revises: c7a2e91b4d36
Create Date: 2026-11-04 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5b8c3e7a914'
down_revision: Union[str, Sequence[str], None] = 'c7a2e91b4d36'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'message_thread',
        sa.Column('thread_id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('member_id', sa.String(length=36), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspace.workspace_id'], name=op.f('fk_message_thread_workspace_id_workspace'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['member_id'], ['member.member_id'], name=op.f('fk_message_thread_member_id_member'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('thread_id', name=op.f('pk_message_thread')),
        sa.UniqueConstraint('workspace_id', 'member_id', name='uq_message_thread_member'),
    )
    op.create_index(op.f('ix_message_thread_workspace_id'), 'message_thread', ['workspace_id'], unique=False)
    op.create_index(op.f('ix_message_thread_member_id'), 'message_thread', ['member_id'], unique=False)

    op.create_table(
        'thread_message',
        sa.Column('message_id', sa.String(length=36), nullable=False),
        sa.Column('thread_id', sa.String(length=36), nullable=False),
        sa.Column('sender', sa.String(length=16), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('reply_channel', sa.String(length=16), nullable=True),
        sa.Column('discord_message_id', sa.String(length=64), nullable=True),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('dm_status', sa.String(length=16), nullable=True),
        sa.Column('dm_failure_reason', sa.String(length=24), nullable=True),
        sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('dm_reported_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['thread_id'], ['message_thread.thread_id'], name=op.f('fk_thread_message_thread_id_message_thread'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('message_id', name=op.f('pk_thread_message')),
    )
    op.create_index(op.f('ix_thread_message_thread_id'), 'thread_message', ['thread_id'], unique=False)
    op.create_index(op.f('ix_thread_message_dm_status'), 'thread_message', ['dm_status'], unique=False)
    op.create_index('uq_thread_message_discord_message', 'thread_message', ['discord_message_id'], unique=True)

    op.create_table(
        'reminder',
        sa.Column('reminder_id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('thread_id', sa.String(length=36), nullable=False),
        sa.Column('task_id', sa.String(length=36), nullable=True),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('origin', sa.String(length=16), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('approved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('approved_by', sa.String(length=36), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('expired_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('message_id', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspace.workspace_id'], name=op.f('fk_reminder_workspace_id_workspace'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['thread_id'], ['message_thread.thread_id'], name=op.f('fk_reminder_thread_id_message_thread'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['task_id'], ['task.task_id'], name=op.f('fk_reminder_task_id_task'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['created_by'], ['member.member_id'], name=op.f('fk_reminder_created_by_member'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['approved_by'], ['member.member_id'], name=op.f('fk_reminder_approved_by_member'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['message_id'], ['thread_message.message_id'], name=op.f('fk_reminder_message_id_thread_message'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('reminder_id', name=op.f('pk_reminder')),
    )
    op.create_index(op.f('ix_reminder_workspace_id'), 'reminder', ['workspace_id'], unique=False)
    op.create_index(op.f('ix_reminder_thread_id'), 'reminder', ['thread_id'], unique=False)
    op.create_index(op.f('ix_reminder_task_id'), 'reminder', ['task_id'], unique=False)
    op.create_index(op.f('ix_reminder_status'), 'reminder', ['status'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('reminder')
    op.drop_table('thread_message')
    op.drop_table('message_thread')
