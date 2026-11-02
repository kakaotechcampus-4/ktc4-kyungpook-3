"""widen meeting status

화자 지정 대기 상태 awaiting_speakers(17자)가 meeting.status(16자)에 들어가지 않아 컬럼을 32자로 넓힌다(#266).
PostgreSQL 에서 varchar 길이를 늘리는 것은 테이블을 다시 쓰지 않는다. 새 상태를 쓰는 코드는 이 변경 뒤에 배포한다.

Revision ID: 2862514e7dbd
Revises: bd244dd27629
Create Date: 2026-11-02 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2862514e7dbd'
down_revision: Union[str, Sequence[str], None] = 'bd244dd27629'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column('meeting', 'status',
               existing_type=sa.String(length=16),
               type_=sa.String(length=32),
               existing_nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    # 16자를 넘는 상태 값(awaiting_speakers)은 줄이면 들어가지 않는다. 처리 중으로 되돌린다.
    op.execute("UPDATE meeting SET status = 'processing' WHERE status = 'awaiting_speakers'")
    op.alter_column('meeting', 'status',
               existing_type=sa.String(length=32),
               type_=sa.String(length=16),
               existing_nullable=False)
