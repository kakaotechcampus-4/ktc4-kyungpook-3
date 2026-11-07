"""add thread message author

PM 이 웹에서 쓴 글을 sender=pm 으로 저장하고 쓴 사람을 thread_message.author_member_id 에 남긴다(#470).
sender 는 문자열 칸이라 값 추가에 스키마 변경이 없다.

되돌리면 pm 글을 bot 으로 바꾸고 작성자는 잃는다. 옛 코드가 pm 을 팀원 말로 읽지 않게 하려는 것이다.

Revision ID: 5ae76a6102a8
Revises: 3c9a1f7d2b64
Create Date: 2026-11-07 20:04:38.337124

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5ae76a6102a8'
down_revision: Union[str, Sequence[str], None] = '3c9a1f7d2b64'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('thread_message', sa.Column('author_member_id', sa.String(length=36), nullable=True))
    op.create_foreign_key(op.f('fk_thread_message_author_member_id_member'), 'thread_message', 'member', ['author_member_id'], ['member_id'], ondelete='SET NULL')


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("UPDATE thread_message SET sender = 'bot' WHERE sender = 'pm'")
    op.drop_constraint(op.f('fk_thread_message_author_member_id_member'), 'thread_message', type_='foreignkey')
    op.drop_column('thread_message', 'author_member_id')
