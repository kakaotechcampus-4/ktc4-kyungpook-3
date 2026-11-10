"""add record edits

팀원이 전사 제목·발화와 AI 가 만든 주제·결정을 고칠 칸을 더한다(#605). 원문은 그대로 두고 고친 값과 고친 표시를 따로 둔다.
이름을 바꾸거나 합친 주제의 옛 키(topic_alias)와 주제에서 뗀 태스크(topic_task_detach)는 재요약이 되살리지 않게 남긴다.

옛 요약은 결정·주제의 행 ID 가 없어 고친 행과 맞출 수 없다. 회의마다 화면이 읽는 최신 요약에 결정 ID(같은 회의의 position)와
주제 ID(그 회의 주제를 저장된 이름으로 찾은 것, 없으면 null)를 채우고 schema_version 을 2 로 올린다. 저장 때
position 이 문서의 순서와 같아 결정은 정확히 맞는다.

되돌리면 두 테이블과 고친 값이 지워진다. 채운 JSON 키는 남지만 옛 코드는 읽지 않는다.

Revision ID: 6631d28f2e1b
Revises: b20d029aec7b
Create Date: 2026-11-10 12:00:00.000000

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6631d28f2e1b'
down_revision: Union[str, Sequence[str], None] = 'b20d029aec7b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_extraction = sa.table(
    "extraction",
    sa.column("extraction_id", sa.String),
    sa.column("meeting_id", sa.String),
    sa.column("created_at", sa.DateTime(timezone=True)),
    sa.column("summary", sa.Text),
)
_decision = sa.table(
    "decision", sa.column("decision_id", sa.String), sa.column("meeting_id", sa.String), sa.column("position", sa.Integer),
)
_topic = sa.table("topic", sa.column("topic_id", sa.String), sa.column("name", sa.String))
_topic_meeting = sa.table("topic_meeting", sa.column("topic_id", sa.String), sa.column("meeting_id", sa.String))


def _backfill_ids(conn) -> None:
    latest: dict[str, tuple[str, str]] = {}
    for extraction_id, meeting_id, summary in conn.execute(
        sa.select(_extraction.c.extraction_id, _extraction.c.meeting_id, _extraction.c.summary)
        .where(_extraction.c.summary.is_not(None))
        .order_by(_extraction.c.created_at, _extraction.c.extraction_id)
    ):
        latest[meeting_id] = (extraction_id, summary)
    for meeting_id, (extraction_id, summary) in latest.items():
        try:
            document = json.loads(summary)
        except ValueError:
            continue
        if not isinstance(document, dict) or document.get("schema_version", 1) >= 2:
            continue
        decision_ids = dict(conn.execute(
            sa.select(_decision.c.position, _decision.c.decision_id).where(_decision.c.meeting_id == meeting_id)
        ).all())
        topic_ids = {name: topic_id for topic_id, name in conn.execute(
            sa.select(_topic.c.topic_id, _topic.c.name)
            .join(_topic_meeting, _topic_meeting.c.topic_id == _topic.c.topic_id)
            .where(_topic_meeting.c.meeting_id == meeting_id)
        )}
        for position, detail in enumerate(document.get("decision_details") or []):
            if isinstance(detail, dict):
                detail["decision_id"] = decision_ids.get(position)
        document["topic_ids"] = [topic_ids.get(name) for name in document.get("topics") or []]
        document["schema_version"] = 2
        conn.execute(
            sa.update(_extraction).where(_extraction.c.extraction_id == extraction_id)
            .values(summary=json.dumps(document, ensure_ascii=False))
        )


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('meeting', sa.Column('title_original', sa.String(length=200), nullable=True))
    op.add_column('meeting', sa.Column('title_edited_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('source', sa.Column('text_edit', sa.Text(), nullable=True))
    op.add_column('topic', sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('decision', sa.Column('state', sa.String(length=16), server_default='valid', nullable=False))
    op.add_column('decision', sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        'topic_alias',
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('name_key', sa.String(length=100), nullable=False),
        sa.Column('topic_id', sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(['topic_id'], ['topic.topic_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspace.workspace_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('workspace_id', 'name_key'),
    )
    op.create_index(op.f('ix_topic_alias_topic_id'), 'topic_alias', ['topic_id'], unique=False)
    op.create_table(
        'topic_task_detach',
        sa.Column('topic_id', sa.String(length=36), nullable=False),
        sa.Column('task_id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(['task_id'], ['task.task_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['topic_id'], ['topic.topic_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspace.workspace_id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('topic_id', 'task_id'),
    )
    op.create_index(op.f('ix_topic_task_detach_task_id'), 'topic_task_detach', ['task_id'], unique=False)
    op.create_index(op.f('ix_topic_task_detach_workspace_id'), 'topic_task_detach', ['workspace_id'], unique=False)
    _backfill_ids(op.get_bind())


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_topic_task_detach_workspace_id'), table_name='topic_task_detach')
    op.drop_index(op.f('ix_topic_task_detach_task_id'), table_name='topic_task_detach')
    op.drop_table('topic_task_detach')
    op.drop_index(op.f('ix_topic_alias_topic_id'), table_name='topic_alias')
    op.drop_table('topic_alias')
    op.drop_column('decision', 'edited_at')
    op.drop_column('decision', 'state')
    op.drop_column('topic', 'edited_at')
    op.drop_column('source', 'text_edit')
    op.drop_column('meeting', 'title_edited_at')
    op.drop_column('meeting', 'title_original')
