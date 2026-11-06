"""add password_reset_token

비밀번호 재설정 링크 토큰을 저장한다(#356). 토큰 원문은 저장하지 않고 sha256 해시만 둔다.

되돌리면 password_reset_token 테이블과 발급된 토큰이 지워진다(이미 바꾼 비밀번호는 그대로).

Revision ID: a7c3e91d5b24
Revises: c4e9a71b3d52
Create Date: 2026-11-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3e91d5b24'
down_revision: Union[str, Sequence[str], None] = 'c4e9a71b3d52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'password_reset_token',
        sa.Column('token_id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('invalidated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['user.user_id'], name=op.f('fk_password_reset_token_user_id_user'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('token_id', name=op.f('pk_password_reset_token')),
        sa.UniqueConstraint('token_hash', name=op.f('uq_password_reset_token_token_hash')),
    )
    op.create_index('ix_password_reset_token_user_created', 'password_reset_token', ['user_id', 'created_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_password_reset_token_user_created', table_name='password_reset_token')
    op.drop_table('password_reset_token')
