"""add user_consent

이용약관·개인정보처리방침 동의 기록을 저장한다(#564). 문서 버전마다 한 행이다.

되돌리면 user_consent 테이블과 동의 기록이 지워진다. 다시 올리면 모든 사용자가 다시 동의해야 한다.

Revision ID: f7f0dc53a63a
Revises: e575b02d8a31
Create Date: 2026-11-08 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f7f0dc53a63a'
down_revision: Union[str, Sequence[str], None] = 'e575b02d8a31'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'user_consent',
        sa.Column('consent_id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('version', sa.String(length=32), nullable=False),
        sa.Column('agreed_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.user_id'], name=op.f('fk_user_consent_user_id_user'), ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('consent_id', name=op.f('pk_user_consent')),
        sa.UniqueConstraint('user_id', 'kind', 'version', name='uq_user_consent_user_kind_version'),
    )
    op.create_index(op.f('ix_user_consent_user_id'), 'user_consent', ['user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_user_consent_user_id'), table_name='user_consent')
    op.drop_table('user_consent')
