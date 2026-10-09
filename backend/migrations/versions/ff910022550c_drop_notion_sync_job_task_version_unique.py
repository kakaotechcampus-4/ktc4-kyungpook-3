"""drop notion sync job task version unique

Notion 동기화 작업 행의 뜻을 "이 버전을 한 번 보내라"에서 "이 Task를 확인해 달라"로 바꾼다(#192).
새 대상 DB가 붙으면 워크스페이스의 모든 Task에 같은 버전의 확인 요청을 다시 쌓으므로
(task_id, task_version) 유일 제약을 지운다. 같은 Task에 여러 줄 있어도 워커가 할 일이 없으면 건너뛴다.

되돌릴 때는 같은 (task_id, task_version) 중 한 줄만 남긴다. 대기·처리 중인 줄을 먼저, 그다음 최근 줄을 남긴다.

Revision ID: ff910022550c
Revises: ad29c5c7aa61
Create Date: 2026-10-11 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ff910022550c'
down_revision: Union[str, Sequence[str], None] = 'ad29c5c7aa61'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('notion_sync_job') as batch_op:
        batch_op.drop_constraint('uq_notion_sync_job_task_version', type_='unique')


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(sa.text(
        """
        DELETE FROM notion_sync_job WHERE job_id IN (
            SELECT job_id FROM (
                SELECT job_id, ROW_NUMBER() OVER (
                    PARTITION BY task_id, task_version
                    ORDER BY CASE WHEN status IN ('pending', 'in_progress') THEN 0 ELSE 1 END,
                             created_at DESC
                ) AS rank
                FROM notion_sync_job
            ) ranked
            WHERE rank > 1
        )
        """
    ))
    with op.batch_alter_table('notion_sync_job') as batch_op:
        batch_op.create_unique_constraint('uq_notion_sync_job_task_version', ['task_id', 'task_version'])
