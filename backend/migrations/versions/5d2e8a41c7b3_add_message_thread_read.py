"""add message_thread_read

메시지 화면의 읽지 않은 수(#480)를 세려고 대화마다 사람(팀원·PM)이 어디까지 읽었는지 저장하는 표를 만든다.
표가 생기기 전에 쌓인 메시지는 이미 본 것으로 쳐야 배포 직후 모든 대화에 읽지 않은 표시가 한꺼번에 뜨지 않는다.
그래서 탈퇴하지 않은 사람에게 기존 대화를 읽은 것으로 채운다. 팀원은 자기 대화, PM 은 워크스페이스의 모든 대화다.

읽은 시각은 DB now() 가 아니라 파이썬에서 만든 UTC 시각을 바인드 파라미터로 넘긴다. 모든 행이 같은 시각이고
sqlite·PostgreSQL 에서 같게 동작하며, 마이그레이션이 도는 동안 들어오는 메시지는 이 시각 뒤라 읽지 않은 것으로 남는다.
앱 코드를 import 하지 않아 앱이 바뀌어도 이 마이그레이션은 그대로다.

Revision ID: 5d2e8a41c7b3
Revises: 3c9a1f7d2b64
Create Date: 2026-11-07 10:00:00.000000

"""
from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5d2e8a41c7b3'
down_revision: Union[str, Sequence[str], None] = '3c9a1f7d2b64'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """읽은 위치 표를 만들고, 탈퇴하지 않은 사람의 기존 대화를 읽은 것으로 채운다."""
    op.create_table(
        'message_thread_read',
        sa.Column('thread_id', sa.String(length=36), nullable=False),
        sa.Column('member_id', sa.String(length=36), nullable=False),
        sa.Column('last_read_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['thread_id'], ['message_thread.thread_id'], name=op.f('fk_message_thread_read_thread_id_message_thread'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['member_id'], ['member.member_id'], name=op.f('fk_message_thread_read_member_id_member'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('thread_id', 'member_id', name=op.f('pk_message_thread_read')),
    )
    op.create_index(op.f('ix_message_thread_read_member_id'), 'message_thread_read', ['member_id'], unique=False)

    conn = op.get_bind()
    now = datetime.now(timezone.utc)
    # 팀원은 자기 대화만, PM 은 같은 워크스페이스의 모든 대화를 본다. PM 자기 대화가 두 번 들어가지 않게 NOT EXISTS 로 거른다.
    statements = (
        """
        INSERT INTO message_thread_read (thread_id, member_id, last_read_at, updated_at)
        SELECT t.thread_id, m.member_id, :now, :now
        FROM message_thread t
        JOIN member m ON m.member_id = t.member_id
        WHERE m.is_deleted = :no
          AND NOT EXISTS (
              SELECT 1 FROM message_thread_read r
              WHERE r.thread_id = t.thread_id AND r.member_id = m.member_id
          )
        """,
        """
        INSERT INTO message_thread_read (thread_id, member_id, last_read_at, updated_at)
        SELECT t.thread_id, m.member_id, :now, :now
        FROM member m
        JOIN message_thread t ON t.workspace_id = m.workspace_id
        WHERE m.role = 'pm'
          AND m.is_deleted = :no
          AND NOT EXISTS (
              SELECT 1 FROM message_thread_read r
              WHERE r.thread_id = t.thread_id AND r.member_id = m.member_id
          )
        """,
    )
    for sql in statements:
        conn.execute(
            sa.text(sql).bindparams(
                sa.bindparam('now', type_=sa.DateTime(timezone=True)),
                sa.bindparam('no', type_=sa.Boolean()),
            ),
            {'now': now, 'no': False},
        )


def downgrade() -> None:
    """읽은 위치 표를 지운다."""
    op.drop_index(op.f('ix_message_thread_read_member_id'), table_name='message_thread_read')
    op.drop_table('message_thread_read')
