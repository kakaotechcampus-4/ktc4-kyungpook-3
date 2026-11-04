"""drop task progress

진행률(%)은 쓰지 않기로 했다. 진행은 상태(todo, in_progress, blocked, done)로만 본다(#303).
task.progress 칼럼을 지운다. task_history 의 changed_field='progress' 옛 줄은 그대로 두며 되돌릴 수 없다.

되돌리면 칼럼만 다시 만든다. 지운 값은 돌아오지 않는다.

Revision ID: c7a2e91b4d36
Revises: 5c1f0a7e93b2
Create Date: 2026-11-04 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c7a2e91b4d36'
down_revision: Union[str, Sequence[str], None] = '5c1f0a7e93b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('task') as batch_op:
        batch_op.drop_column('progress')


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('task') as batch_op:
        batch_op.add_column(sa.Column('progress', sa.Integer(), nullable=True))
