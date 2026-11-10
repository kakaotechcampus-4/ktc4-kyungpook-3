"""add meeting_audio

회의 하나의 재생용 녹음 기록 표(#659). 보관 기간은 retention_from(보관 기간을 세기 시작한 시각)부터 센다.
처리가 끝났거나 지워진 기존 회의에는 행을 만들지 않는다. 이전 녹음은 처리가 끝나면 이미 지워졌기 때문이다.
처리 중인 기존 업로드 회의는 PM 이 화자를 지정하는 동안 녹음을 들어야 하므로 meeting_upload 로 행을 채운다.

Revision ID: c7a1e4d92b35
Revises: b20d029aec7b
Create Date: 2026-11-10 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7a1e4d92b35'
down_revision: Union[str, Sequence[str], None] = 'b20d029aec7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'meeting_audio',
        sa.Column('meeting_id', sa.String(length=36), nullable=False),
        sa.Column('filename', sa.String(length=32), nullable=False),
        sa.Column('content_type', sa.String(length=64), nullable=False),
        sa.Column('size_bytes', sa.BigInteger(), nullable=False),
        sa.Column('retention_from', sa.DateTime(timezone=True), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['meeting_id'], ['meeting.meeting_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('meeting_id'),
    )
    # 처리 중(done·failed 가 아님)인 기존 업로드 회의의 녹음을 재생 기록으로 옮긴다.
    # 첫 배포가 로컬 저장소여도 진행 중인 회의는 바로 들을 수 있다. 파일 정보는 확장자로 짐작한다.
    op.execute(
        """
        INSERT INTO meeting_audio (meeting_id, filename, content_type, size_bytes, retention_from, deleted_at)
        SELECT u.meeting_id,
               u.stored_filename,
               CASE
                   WHEN lower(u.stored_filename) LIKE '%.wav' THEN 'audio/wav'
                   WHEN lower(u.stored_filename) LIKE '%.mp3' THEN 'audio/mpeg'
                   WHEN lower(u.stored_filename) LIKE '%.m4a' THEN 'audio/mp4'
                   WHEN lower(u.stored_filename) LIKE '%.ogg' THEN 'audio/ogg'
                   WHEN lower(u.stored_filename) LIKE '%.webm' THEN 'audio/webm'
                   ELSE 'application/octet-stream'
               END,
               u.size_bytes,
               u.uploaded_at,
               NULL
        FROM meeting_upload u
        JOIN meeting m ON m.meeting_id = u.meeting_id
        WHERE m.deleted_at IS NULL
          AND m.status NOT IN ('done', 'failed')
        """
    )


def downgrade() -> None:
    op.drop_table('meeting_audio')
