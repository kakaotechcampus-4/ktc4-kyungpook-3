"""add thread message author

PM 이 웹에서 쓴 글을 sender=pm 으로 저장하고 쓴 사람을 thread_message.author_member_id 에 남긴다(#470).
sender 는 문자열 칸이라 값 추가에 스키마 변경이 없다.

되돌리면 pm 글을 bot 으로 바꾸고 작성자는 잃는다. 옛 코드가 pm 을 팀원 말로 읽지 않게 하려는 것이다.
아직 안 나간 pm 글은 못 보냄으로 닫는다. 옛 코드는 저장된 본문을 그대로 DM 으로 보내기 때문이다.
나간 pm 글은 옛 코드에서 재촉으로 읽혀 답장 기다림 표시가 생기고 첫 재촉 소개가 빠질 수 있다.

Revision ID: 5ae76a6102a8
Revises: c4a7e19d5b32
Create Date: 2026-11-07 20:04:38.337124

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5ae76a6102a8'
down_revision: Union[str, Sequence[str], None] = 'c4a7e19d5b32'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('thread_message', sa.Column('author_member_id', sa.String(length=36), nullable=True))
    op.create_foreign_key(op.f('fk_thread_message_author_member_id_member'), 'thread_message', 'member', ['author_member_id'], ['member_id'], ondelete='SET NULL')


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(
        "UPDATE thread_message SET dm_status = 'failed', dm_failure_reason = 'unknown' "
        "WHERE sender = 'pm' AND dm_status IN ('pending', 'claimed')"
    )
    op.execute("UPDATE thread_message SET sender = 'bot' WHERE sender = 'pm'")
    op.drop_constraint(op.f('fk_thread_message_author_member_id_member'), 'thread_message', type_='foreignkey')
    op.drop_column('thread_message', 'author_member_id')
