"""drop audio tables and replaced columns

오디오 테이블(meeting_audio, audio_segment)과 source·evidence로 대체된 컬럼을 제거한다(#120).
extraction_item.evidence_*, extraction.transcript_path, task_history.is_auto,
alias_resolution_log.evidence_quote가 대상이다. downgrade는 구조만 되살리고 값은 비어 있다.

Revision ID: b5d8f03a6c41
Revises: a7c2e94f1b30
Create Date: 2026-09-30 12:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b5d8f03a6c41'
down_revision: Union[str, Sequence[str], None] = 'a7c2e94f1b30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_table('meeting_audio')
    op.drop_index(op.f('ix_audio_segment_merged_start_ms'), table_name='audio_segment')
    op.drop_index(op.f('ix_audio_segment_meeting_id'), table_name='audio_segment')
    op.drop_table('audio_segment')

    op.drop_column('extraction_item', 'evidence_quote')
    op.drop_column('extraction_item', 'evidence_speaker')
    op.drop_column('extraction_item', 'evidence_at_ms')
    op.drop_column('extraction', 'transcript_path')
    op.drop_column('alias_resolution_log', 'evidence_quote')
    op.drop_index(op.f('ix_task_history_is_auto'), table_name='task_history')
    op.drop_column('task_history', 'is_auto')


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column('task_history', sa.Column('is_auto', sa.Boolean(), server_default=sa.false(), nullable=False))
    op.alter_column('task_history', 'is_auto', server_default=None)
    op.create_index(op.f('ix_task_history_is_auto'), 'task_history', ['is_auto'], unique=False)
    op.add_column('alias_resolution_log', sa.Column('evidence_quote', sa.Text(), nullable=True))
    op.add_column('extraction', sa.Column('transcript_path', sa.Text(), nullable=True))
    op.add_column('extraction_item', sa.Column('evidence_at_ms', sa.Integer(), nullable=True))
    op.add_column('extraction_item', sa.Column('evidence_speaker', sa.String(length=100), nullable=True))
    op.add_column('extraction_item', sa.Column('evidence_quote', sa.Text(), nullable=True))

    op.create_table('audio_segment',
    sa.Column('segment_id', sa.String(length=36), nullable=False),
    sa.Column('meeting_id', sa.String(length=36), nullable=False),
    sa.Column('member_id', sa.String(length=36), nullable=True),
    sa.Column('discord_user_id', sa.String(length=64), nullable=True),
    sa.Column('merged_start_ms', sa.Integer(), nullable=False),
    sa.Column('merged_end_ms', sa.Integer(), nullable=False),
    sa.Column('actual_start_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('actual_end_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('track_file_path', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['meeting_id'], ['meeting.meeting_id'], name=op.f('fk_audio_segment_meeting_id_meeting'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['member_id'], ['member.member_id'], name=op.f('fk_audio_segment_member_id_member'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('segment_id', name=op.f('pk_audio_segment'))
    )
    op.create_index(op.f('ix_audio_segment_meeting_id'), 'audio_segment', ['meeting_id'], unique=False)
    op.create_index(op.f('ix_audio_segment_merged_start_ms'), 'audio_segment', ['merged_start_ms'], unique=False)
    op.create_table('meeting_audio',
    sa.Column('audio_id', sa.String(length=36), nullable=False),
    sa.Column('meeting_id', sa.String(length=36), nullable=False),
    sa.Column('merged_file_path', sa.Text(), nullable=False),
    sa.Column('duration_ms', sa.Integer(), nullable=False),
    sa.Column('track_count', sa.Integer(), nullable=False),
    sa.Column('is_complete', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['meeting_id'], ['meeting.meeting_id'], name=op.f('fk_meeting_audio_meeting_id_meeting'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('audio_id', name=op.f('pk_meeting_audio')),
    sa.UniqueConstraint('meeting_id', name=op.f('uq_meeting_audio_meeting_id'))
    )
