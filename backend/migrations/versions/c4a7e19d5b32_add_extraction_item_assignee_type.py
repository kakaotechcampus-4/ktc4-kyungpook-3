"""add extraction item assignee_type

추출 항목에 담당자 표현의 종류(first·thirdname·thirdrole 등)를 저장한다(#459).
승인할 때 사용자가 고른 담당자를 발화의 표현("하은이가", "BE 리더가")과 이어 별칭으로 배우려면,
그 표현이 이름·역할처럼 학습해도 되는 종류인지 승인 시점에 알아야 한다.

되돌리면 칸이 지워져 종류를 알 수 없게 된다. 이미 저장된 별칭과 승인된 task 는 그대로 남는다.
이 변경 전에 만든 항목은 값이 NULL 이고 학습 대상이 아니다.

Revision ID: c4a7e19d5b32
Revises: b0d32ee4abcb
Create Date: 2026-11-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4a7e19d5b32'
down_revision: Union[str, Sequence[str], None] = 'b0d32ee4abcb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('extraction_item', sa.Column('assignee_type', sa.String(length=16), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('extraction_item') as batch_op:
        batch_op.drop_column('assignee_type')
