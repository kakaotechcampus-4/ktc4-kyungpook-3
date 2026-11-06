"""add signup_email_code

가입 이메일 인증 코드를 저장하고(#427, 코드 원문 없이 HMAC 만 둔다), 소셜 계정 하나가 사용자 하나에만
이어지도록 user(provider, provider_id) 를 unique 로 묶는다. 기존 행은 provider_id 가 NULL 이라 겹치지 않는다.

되돌리면 signup_email_code 테이블과 진행 중인 인증 코드가 지워진다. 이어 둔 카카오 값은 user 행에 남는다.

Revision ID: d2f6b81c4e07
Revises: a3d7f91c5e28
Create Date: 2026-11-06 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2f6b81c4e07'
down_revision: Union[str, Sequence[str], None] = 'a3d7f91c5e28'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'signup_email_code',
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('code_hash', sa.String(length=64), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('sent_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('window_started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('window_count', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('email', name=op.f('pk_signup_email_code')),
    )
    op.create_unique_constraint('uq_user_provider_provider_id', 'user', ['provider', 'provider_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('uq_user_provider_provider_id', 'user', type_='unique')
    op.drop_table('signup_email_code')
