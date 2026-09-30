"""add source evidence and meeting duration

전사 발화(source)와 추출 항목·task의 근거(evidence) 테이블, meeting.duration_ms,
alias_resolution_log.source_id를 추가하고 user.provider를 NOT NULL로 바꾼다(#120).
provider가 비어 있는 기존 사용자는 'local'로 채운다.

Revision ID: a7c2e94f1b30
Revises: e3a91c5b7d20
Create Date: 2026-09-30 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c2e94f1b30'
down_revision: Union[str, Sequence[str], None] = 'e3a91c5b7d20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('meeting', sa.Column('duration_ms', sa.Integer(), nullable=True))

    op.create_table('source',
    sa.Column('source_id', sa.String(length=36), nullable=False),
    sa.Column('meeting_id', sa.String(length=36), nullable=False),
    sa.Column('seq', sa.Integer(), nullable=False),
    sa.Column('speaker_discord_user_id', sa.String(length=64), nullable=True),
    sa.Column('member_id', sa.String(length=36), nullable=True),
    sa.Column('start_ms', sa.Integer(), nullable=False),
    sa.Column('end_ms', sa.Integer(), nullable=False),
    sa.Column('text', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['meeting_id'], ['meeting.meeting_id'], name=op.f('fk_source_meeting_id_meeting'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['member_id'], ['member.member_id'], name=op.f('fk_source_member_id_member'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('source_id', name=op.f('pk_source')),
    sa.UniqueConstraint('meeting_id', 'seq', name='uq_source_meeting_seq')
    )
    op.create_index(op.f('ix_source_meeting_id'), 'source', ['meeting_id'], unique=False)
    op.create_index(op.f('ix_source_member_id'), 'source', ['member_id'], unique=False)

    op.create_table('evidence',
    sa.Column('evidence_id', sa.String(length=36), nullable=False),
    sa.Column('item_id', sa.String(length=36), nullable=True),
    sa.Column('task_id', sa.String(length=36), nullable=True),
    sa.Column('source_id', sa.String(length=36), nullable=False),
    sa.Column('type', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint('item_id IS NOT NULL OR task_id IS NOT NULL', name=op.f('ck_evidence_ck_evidence_item_or_task')),
    sa.ForeignKeyConstraint(['item_id'], ['extraction_item.item_id'], name=op.f('fk_evidence_item_id_extraction_item'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['source_id'], ['source.source_id'], name=op.f('fk_evidence_source_id_source'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['task_id'], ['task.task_id'], name=op.f('fk_evidence_task_id_task'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('evidence_id', name=op.f('pk_evidence')),
    sa.UniqueConstraint('item_id', 'source_id', 'type', name='uq_evidence_item_source_type')
    )
    op.create_index(op.f('ix_evidence_item_id'), 'evidence', ['item_id'], unique=False)
    op.create_index(op.f('ix_evidence_source_id'), 'evidence', ['source_id'], unique=False)
    op.create_index(op.f('ix_evidence_task_id'), 'evidence', ['task_id'], unique=False)
    op.create_index('uq_evidence_task_source_type', 'evidence', ['task_id', 'source_id', 'type'], unique=True, postgresql_where=sa.text('item_id IS NULL'))

    op.add_column('alias_resolution_log', sa.Column('source_id', sa.String(length=36), nullable=True))
    op.create_index(op.f('ix_alias_resolution_log_source_id'), 'alias_resolution_log', ['source_id'], unique=False)
    op.create_foreign_key(op.f('fk_alias_resolution_log_source_id_source'), 'alias_resolution_log', 'source', ['source_id'], ['source_id'], ondelete='SET NULL')

    op.execute('UPDATE "user" SET provider = \'local\' WHERE provider IS NULL')
    op.alter_column('user', 'provider', existing_type=sa.String(length=20), nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column('user', 'provider', existing_type=sa.String(length=20), nullable=True)

    op.drop_constraint(op.f('fk_alias_resolution_log_source_id_source'), 'alias_resolution_log', type_='foreignkey')
    op.drop_index(op.f('ix_alias_resolution_log_source_id'), table_name='alias_resolution_log')
    op.drop_column('alias_resolution_log', 'source_id')

    op.drop_index('uq_evidence_task_source_type', table_name='evidence', postgresql_where=sa.text('item_id IS NULL'))
    op.drop_index(op.f('ix_evidence_task_id'), table_name='evidence')
    op.drop_index(op.f('ix_evidence_source_id'), table_name='evidence')
    op.drop_index(op.f('ix_evidence_item_id'), table_name='evidence')
    op.drop_table('evidence')

    op.drop_index(op.f('ix_source_member_id'), table_name='source')
    op.drop_index(op.f('ix_source_meeting_id'), table_name='source')
    op.drop_table('source')

    op.drop_column('meeting', 'duration_ms')
