"""add meeting upload

웹에서 올린 녹음의 정보(저장 파일명, 원래 파일명, 크기, 형식, 올린 사람, 업로드 시각, 참석자)를
meeting_upload 에 남긴다(#219). 녹음 파일은 디스크에 두고, AI 대기 목록은 이 테이블로 만든다.
AI 가 가져간 시각(claimed_at)도 여기에 둔다. 업로드 회의는 처음부터 processing 이라 상태로는 가릴 수 없다.
새 테이블만 추가하므로 이전 코드는 이 테이블을 몰라도 그대로 돈다.

Revision ID: bd244dd27629
Revises: 5e1c7a9d3f82
Create Date: 2026-10-14 17:24:46.121194

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bd244dd27629'
down_revision: Union[str, Sequence[str], None] = '5e1c7a9d3f82'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('meeting_upload',
    sa.Column('meeting_id', sa.String(length=36), nullable=False),
    sa.Column('stored_filename', sa.String(length=32), nullable=False),
    sa.Column('original_filename', sa.String(length=255), nullable=True),
    sa.Column('size_bytes', sa.BigInteger(), nullable=False),
    sa.Column('content_type', sa.String(length=100), nullable=True),
    sa.Column('uploaded_by_member_id', sa.String(length=36), nullable=True),
    sa.Column('uploaded_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('attendees', sa.Text(), nullable=False),
    sa.Column('claimed_at', sa.DateTime(timezone=True), nullable=True),
    sa.ForeignKeyConstraint(['meeting_id'], ['meeting.meeting_id'], name=op.f('fk_meeting_upload_meeting_id_meeting'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['uploaded_by_member_id'], ['member.member_id'], name=op.f('fk_meeting_upload_uploaded_by_member_id_member'), ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('meeting_id', name=op.f('pk_meeting_upload'))
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('meeting_upload')
