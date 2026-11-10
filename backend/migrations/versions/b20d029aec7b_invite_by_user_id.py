"""invite by user id

초대를 이메일 대신 가입한 사용자(invitation.invited_user_id)에 묶고 invitation.email 을 지운다(#628). 카카오만으로
가입한 계정은 이메일이 없어(#610) 이메일 초대를 받을 수 없었다. 한 워크스페이스에서 같은 사용자의 대기 초대는 하나만
부분 고유 인덱스로 허용한다.

지금 대기 중인 초대는 모두 취소한다(responded_at 은 마이그레이션 시각). 실제 사용자가 없고 팀이 시험으로 보낸
초대뿐이다. 닫힌 초대는 수락한 계정, 없으면 이메일이 같은 가입자로 대상을 채우고, 그래도 대상이 없는 시험 기록은
지운다.

downgrade 는 이메일 없는 계정에 보낸 초대가 하나라도 있으면 아무것도 바꾸지 않고 RuntimeError 로 멈춘다. 가짜
이메일을 넣지 않는다. 없으면 초대받은 계정의 이메일로 email 을 다시 채운다. 취소한 대기 초대는 되살리지 않는다.

Revision ID: b20d029aec7b
Revises: 950ecd8babeb
Create Date: 2026-11-10 12:00:00.000000

"""
from datetime import datetime, timezone
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b20d029aec7b'
down_revision: Union[str, Sequence[str], None] = '950ecd8babeb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PENDING = sa.text("status = 'pending'")


def _drop_pending_index(name: str) -> None:
    # sqlite 는 batch 로 테이블을 다시 만들 때 부분 인덱스의 WHERE 를 잃을 수 있어 batch 밖에서 지우고 다시 만든다.
    op.drop_index(name, table_name='invitation', postgresql_where=PENDING, sqlite_where=PENDING)


def _create_pending_index(name: str, columns: list[str]) -> None:
    op.create_index(name, 'invitation', columns, unique=True, postgresql_where=PENDING, sqlite_where=PENDING)


def upgrade() -> None:
    _drop_pending_index('uq_invitation_pending_email')
    _drop_pending_index('uq_invitation_pending_member')
    with op.batch_alter_table('invitation') as batch:
        batch.add_column(sa.Column('invited_user_id', sa.String(length=36), nullable=True))
    conn = op.get_bind()
    conn.execute(
        sa.text("UPDATE invitation SET status = 'canceled', responded_at = :now WHERE status = 'pending'"),
        {"now": datetime.now(timezone.utc)},
    )
    conn.execute(sa.text(
        'UPDATE invitation SET invited_user_id = COALESCE('
        'accepted_user_id, (SELECT "user".user_id FROM "user" WHERE "user".email = invitation.email))'
    ))
    conn.execute(sa.text('DELETE FROM invitation WHERE invited_user_id IS NULL'))
    with op.batch_alter_table('invitation') as batch:
        batch.alter_column('invited_user_id', existing_type=sa.String(length=36), nullable=False)
        batch.create_foreign_key(
            batch.f('fk_invitation_invited_user_id_user'), 'user', ['invited_user_id'], ['user_id'], ondelete='CASCADE'
        )
        batch.create_index(batch.f('ix_invitation_invited_user_id'), ['invited_user_id'], unique=False)
        batch.drop_index(batch.f('ix_invitation_email'))
        batch.drop_column('email')
    _create_pending_index('uq_invitation_pending_member', ['member_id'])
    _create_pending_index('uq_invitation_pending_user', ['workspace_id', 'invited_user_id'])


def downgrade() -> None:
    conn = op.get_bind()
    missing = conn.execute(sa.text(
        'SELECT count(*) FROM invitation JOIN "user" ON "user".user_id = invitation.invited_user_id '
        'WHERE "user".email IS NULL'
    )).scalar_one()
    if missing:
        raise RuntimeError(
            f"이메일 없는 계정에 보낸 초대 {missing}개가 있어 되돌리지 않았습니다. "
            "invitation.email 을 다시 필수로 하려면 이 초대들을 먼저 정리해야 합니다."
        )
    _drop_pending_index('uq_invitation_pending_user')
    _drop_pending_index('uq_invitation_pending_member')
    with op.batch_alter_table('invitation') as batch:
        batch.add_column(sa.Column('email', sa.String(length=255), nullable=True))
    conn.execute(sa.text(
        'UPDATE invitation SET email = (SELECT "user".email FROM "user" WHERE "user".user_id = invitation.invited_user_id)'
    ))
    with op.batch_alter_table('invitation') as batch:
        batch.alter_column('email', existing_type=sa.String(length=255), nullable=False)
        batch.create_index(batch.f('ix_invitation_email'), ['email'], unique=False)
        batch.drop_index(batch.f('ix_invitation_invited_user_id'))
        batch.drop_constraint(batch.f('fk_invitation_invited_user_id_user'), type_='foreignkey')
        batch.drop_column('invited_user_id')
    _create_pending_index('uq_invitation_pending_member', ['member_id'])
    _create_pending_index('uq_invitation_pending_email', ['workspace_id', 'email'])
