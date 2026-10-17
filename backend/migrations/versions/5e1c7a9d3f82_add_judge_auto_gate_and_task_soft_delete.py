"""add judge auto gate fields and task soft delete

judge 경로의 새 항목을 auto로 보낼지 정하는 근거를 추출 항목에 저장한다(#232). AI가 보낸 할 일·마감의
근거 상태(certain/inferred/missing)와 AI가 판단할 때 본 유사 검색 결과(기존 태스크 수, 가장 높은 유사도)다.
이미 저장된 항목은 이 값을 보내지 않던 때라 NULL로 둔다.

auto로 만든 task를 PM이 되돌릴 수 있게 task에 지움 표시를, 추출 항목에 되돌린 시각과 PM을 추가한다.
기존 task는 모두 지우지 않은 것으로 둔다.

Revision ID: 5e1c7a9d3f82
Revises: b9e4d72a1c58
Create Date: 2026-10-16 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5e1c7a9d3f82'
down_revision: Union[str, Sequence[str], None] = 'b9e4d72a1c58'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('extraction_item') as batch_op:
        batch_op.add_column(sa.Column('task_evidence_status', sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column('due_evidence_status', sa.String(length=16), nullable=True))
        batch_op.add_column(sa.Column('similar_count', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('top_similarity', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('reverted_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.add_column(sa.Column('reverted_by', sa.String(length=36), nullable=True))
        batch_op.create_foreign_key(
            'fk_extraction_item_reverted_by_member', 'member', ['reverted_by'], ['member_id'],
            ondelete='SET NULL',
        )
    with op.batch_alter_table('task') as batch_op:
        batch_op.add_column(
            sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False)
        )
        batch_op.add_column(sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index('ix_task_is_deleted', ['is_deleted'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    # 지운 task는 지움 표시가 사라지면 다시 보이게 된다. 되돌리기 전에 직접 정리해야 한다
    with op.batch_alter_table('task') as batch_op:
        batch_op.drop_index('ix_task_is_deleted')
        batch_op.drop_column('deleted_at')
        batch_op.drop_column('is_deleted')
    with op.batch_alter_table('extraction_item') as batch_op:
        batch_op.drop_constraint('fk_extraction_item_reverted_by_member', type_='foreignkey')
        batch_op.drop_column('reverted_by')
        batch_op.drop_column('reverted_at')
        batch_op.drop_column('top_similarity')
        batch_op.drop_column('similar_count')
        batch_op.drop_column('due_evidence_status')
        batch_op.drop_column('task_evidence_status')
