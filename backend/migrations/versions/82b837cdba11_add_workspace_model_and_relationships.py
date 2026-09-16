"""Add Workspace model and relationships

Revision ID: 82b837cdba11
Revises: 051b67bf8358
Create Date: 2026-09-15 21:23:15.377558

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '82b837cdba11'
down_revision: Union[str, Sequence[str], None] = '051b67bf8358'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    SQLite는 ALTER TABLE로 제약조건을 바꿀 수 없어서(FK 추가/삭제, UNIQUE 추가,
    NOT NULL 변경 전부 포함), 원래 autogenerate가 뽑아낸 명령을 그대로 두면
    `NotImplementedError`로 깨진다. 테이블별로 batch_alter_table 안에 묶어서
    "복사-후-교체" 방식으로 처리하고, 이름 없는 제약조건은 batch mode가 다룰 수
    없으므로 전부 명시적인 이름을 붙인다.
    """
    op.create_table('workspace',
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('workspace_id')
    )

    with op.batch_alter_table('alias_resolution_log', recreate='always') as batch_op:
        batch_op.add_column(sa.Column('resolved_member_id', sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            'fk_alias_resolution_log_workspace_id_workspace',
            'workspace', ['workspace_id'], ['workspace_id'], ondelete='CASCADE',
        )
        batch_op.create_foreign_key(
            'fk_alias_resolution_log_resolved_member_id_member',
            'member', ['resolved_member_id'], ['member_id'], ondelete='SET NULL',
        )
        batch_op.drop_column('resolved_member')

    with op.batch_alter_table('alias_review', recreate='always') as batch_op:
        batch_op.add_column(sa.Column('corrected_member_id', sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            'fk_alias_review_corrected_member_id_member',
            'member', ['corrected_member_id'], ['member_id'], ondelete='SET NULL',
        )
        batch_op.drop_column('corrected_member')

    with op.batch_alter_table('approval_request') as batch_op:
        batch_op.create_foreign_key(
            'fk_approval_request_workspace_id_workspace',
            'workspace', ['workspace_id'], ['workspace_id'], ondelete='CASCADE',
        )

    with op.batch_alter_table('meeting') as batch_op:
        batch_op.create_foreign_key(
            'fk_meeting_workspace_id_workspace',
            'workspace', ['workspace_id'], ['workspace_id'], ondelete='CASCADE',
        )
        batch_op.drop_column('audio_merged')
        batch_op.drop_column('transcribed')
        batch_op.drop_column('extracted')

    with op.batch_alter_table('member') as batch_op:
        batch_op.alter_column('discord_user_id',
                   existing_type=sa.VARCHAR(length=64),
                   nullable=True)
        batch_op.drop_index('ix_member_discord_user_id')
        batch_op.create_index('ix_member_discord_user_id', ['discord_user_id'], unique=False)
        batch_op.create_unique_constraint('uq_workspace_discord_user', ['workspace_id', 'discord_user_id'])
        batch_op.create_foreign_key(
            'fk_member_workspace_id_workspace',
            'workspace', ['workspace_id'], ['workspace_id'], ondelete='CASCADE',
        )

    with op.batch_alter_table('member_alias') as batch_op:
        batch_op.create_foreign_key(
            'fk_member_alias_workspace_id_workspace',
            'workspace', ['workspace_id'], ['workspace_id'], ondelete='CASCADE',
        )

    with op.batch_alter_table('task') as batch_op:
        batch_op.create_foreign_key(
            'fk_task_workspace_id_workspace',
            'workspace', ['workspace_id'], ['workspace_id'], ondelete='CASCADE',
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('task') as batch_op:
        batch_op.drop_constraint('fk_task_workspace_id_workspace', type_='foreignkey')

    with op.batch_alter_table('member_alias') as batch_op:
        batch_op.drop_constraint('fk_member_alias_workspace_id_workspace', type_='foreignkey')

    with op.batch_alter_table('member') as batch_op:
        batch_op.drop_constraint('fk_member_workspace_id_workspace', type_='foreignkey')
        batch_op.drop_constraint('uq_workspace_discord_user', type_='unique')
        batch_op.drop_index('ix_member_discord_user_id')
        batch_op.create_index('ix_member_discord_user_id', ['discord_user_id'], unique=True)
        batch_op.alter_column('discord_user_id',
                   existing_type=sa.VARCHAR(length=64),
                   nullable=False)

    with op.batch_alter_table('meeting') as batch_op:
        batch_op.add_column(sa.Column('extracted', sa.BOOLEAN(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('transcribed', sa.BOOLEAN(), nullable=False, server_default=sa.false()))
        batch_op.add_column(sa.Column('audio_merged', sa.BOOLEAN(), nullable=False, server_default=sa.false()))
        batch_op.drop_constraint('fk_meeting_workspace_id_workspace', type_='foreignkey')

    with op.batch_alter_table('approval_request') as batch_op:
        batch_op.drop_constraint('fk_approval_request_workspace_id_workspace', type_='foreignkey')

    with op.batch_alter_table('alias_review', recreate='always') as batch_op:
        batch_op.add_column(sa.Column('corrected_member', sa.VARCHAR(length=36), nullable=True))
        batch_op.drop_constraint('fk_alias_review_corrected_member_id_member', type_='foreignkey')
        batch_op.drop_column('corrected_member_id')

    with op.batch_alter_table('alias_resolution_log', recreate='always') as batch_op:
        batch_op.add_column(sa.Column('resolved_member', sa.VARCHAR(length=36), nullable=True))
        batch_op.drop_constraint('fk_alias_resolution_log_workspace_id_workspace', type_='foreignkey')
        batch_op.drop_constraint('fk_alias_resolution_log_resolved_member_id_member', type_='foreignkey')
        batch_op.drop_column('resolved_member_id')

    op.drop_table('workspace')
