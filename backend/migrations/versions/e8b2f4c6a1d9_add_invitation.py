"""add invitation

PM 이 로그인 계정 없는 팀원에게 가입 이메일로 보내는 초대를 저장한다(#319). 그 이메일로 로그인한 사람이 수락하면
member.user_id 가 그 계정으로 이어진다. 한 팀원에 대기 초대 하나, 한 워크스페이스에서 같은 이메일의 대기 초대 하나만
부분 고유 인덱스로 허용한다.

되돌리면 invitation 테이블과 초대 이력이 지워진다. 수락으로 이어진 member.user_id 는 그대로 남는다.

Revision ID: e8b2f4c6a1d9
Revises: d5b8c3e7a914
Create Date: 2026-11-04 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e8b2f4c6a1d9'
down_revision: Union[str, Sequence[str], None] = 'd5b8c3e7a914'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'invitation',
        sa.Column('invitation_id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('member_id', sa.String(length=36), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('invited_by_user_id', sa.String(length=36), nullable=True),
        sa.Column('accepted_user_id', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspace.workspace_id'], name=op.f('fk_invitation_workspace_id_workspace'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['member_id'], ['member.member_id'], name=op.f('fk_invitation_member_id_member'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['invited_by_user_id'], ['user.user_id'], name=op.f('fk_invitation_invited_by_user_id_user'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['accepted_user_id'], ['user.user_id'], name=op.f('fk_invitation_accepted_user_id_user'), ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('invitation_id', name=op.f('pk_invitation')),
    )
    op.create_index(op.f('ix_invitation_workspace_id'), 'invitation', ['workspace_id'], unique=False)
    op.create_index(op.f('ix_invitation_member_id'), 'invitation', ['member_id'], unique=False)
    op.create_index(op.f('ix_invitation_email'), 'invitation', ['email'], unique=False)
    op.create_index(
        'uq_invitation_pending_member', 'invitation', ['member_id'],
        unique=True, postgresql_where=sa.text("status = 'pending'"), sqlite_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        'uq_invitation_pending_email', 'invitation', ['workspace_id', 'email'],
        unique=True, postgresql_where=sa.text("status = 'pending'"), sqlite_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(
        'uq_invitation_pending_email', table_name='invitation',
        postgresql_where=sa.text("status = 'pending'"), sqlite_where=sa.text("status = 'pending'"),
    )
    op.drop_index(
        'uq_invitation_pending_member', table_name='invitation',
        postgresql_where=sa.text("status = 'pending'"), sqlite_where=sa.text("status = 'pending'"),
    )
    op.drop_index(op.f('ix_invitation_email'), table_name='invitation')
    op.drop_index(op.f('ix_invitation_member_id'), table_name='invitation')
    op.drop_index(op.f('ix_invitation_workspace_id'), table_name='invitation')
    op.drop_table('invitation')
