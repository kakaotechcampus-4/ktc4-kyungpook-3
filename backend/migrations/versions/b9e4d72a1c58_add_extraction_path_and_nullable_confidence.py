"""add extraction path and nullable confidence

추출이 AI의 어느 경로(legacy, judge)로 만들어졌는지 기록하는 컬럼을 추가하고, 추출 항목의
확신도를 NULL(측정 안 함)로 둘 수 있게 한다(#201). judge 경로는 확신도를 보내지 않는데, 지금까지는
0.0으로 저장돼 측정값 0과 구분되지 않았다.

이미 저장된 추출은 요청에서 어떤 키를 보냈는지 남아 있지 않으므로 저장된 항목으로 경로를 채운다.
judge 항목은 doc_text와 category가 항상 있고 legacy 항목은 둘 다 없다. 항목이 없는 추출은
판별할 근거가 없어 NULL로 둔다. 기존 항목의 확신도 값은 바꾸지 않는다.

Revision ID: b9e4d72a1c58
Revises: ff910022550c
Create Date: 2026-10-11 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9e4d72a1c58'
down_revision: Union[str, Sequence[str], None] = 'ff910022550c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CONFIDENCE_COLUMNS = ('task_confidence', 'due_confidence', 'confidence')


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('extraction', sa.Column('extraction_path', sa.String(length=16), nullable=True))
    op.execute(sa.text(
        """
        UPDATE extraction SET extraction_path = CASE
            WHEN EXISTS (
                SELECT 1 FROM extraction_item
                WHERE extraction_item.extraction_id = extraction.extraction_id
                  AND (extraction_item.doc_text IS NOT NULL OR extraction_item.category IS NOT NULL)
            ) THEN 'judge'
            WHEN EXISTS (
                SELECT 1 FROM extraction_item
                WHERE extraction_item.extraction_id = extraction.extraction_id
            ) THEN 'legacy'
        END
        """
    ))
    with op.batch_alter_table('extraction_item') as batch_op:
        for column in _CONFIDENCE_COLUMNS:
            batch_op.alter_column(column, existing_type=sa.Float(), nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    # NOT NULL로 되돌리기 전에 측정하지 않은 값을 예전처럼 0.0으로 채운다
    for column in _CONFIDENCE_COLUMNS:
        op.execute(sa.text(f'UPDATE extraction_item SET {column} = 0.0 WHERE {column} IS NULL'))
    with op.batch_alter_table('extraction_item') as batch_op:
        for column in _CONFIDENCE_COLUMNS:
            batch_op.alter_column(column, existing_type=sa.Float(), nullable=False)
    op.drop_column('extraction', 'extraction_path')
