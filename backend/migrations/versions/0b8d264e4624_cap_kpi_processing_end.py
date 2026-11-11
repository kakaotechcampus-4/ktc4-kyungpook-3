"""cap kpi processing end

kpi.meeting_fact.processing_seconds 의 녹음 끝에 ended_at 상한을 둔다(#675, PR #684 리뷰).

디스코드 회의는 녹음 끝을 started_at + duration_ms(마지막 발화 끝)로 본다. 그런데 AI 가 실패한 회의를 교체해
다시 만들거나, /record 때 생성이 실패해 인계 단계에서 처음 만든 회의는 started_at 을 받지 못해 회의 행을 만든
시각(추출 직전)이 되고, duration_ms 는 원래 녹음 전체 길이다. 그러면 녹음 끝이 추출보다 늦어 처리 시간이 음수가
된다. 녹음 끝은 /end 시각(ended_at)보다 늦을 수 없으므로 LEAST(..., ended_at) 로 막는다.

CREATE OR REPLACE VIEW 라 컬럼 이름·순서·타입이 그대로이고, 읽기 계정의 GRANT 도 남는다(다시 돌리지 않는다).
PostgreSQL 전용이다. 다른 DB 에서는 아무것도 하지 않는다.

Revision ID: 0b8d264e4624
Revises: c4f7a2d91e3b
Create Date: 2026-11-11 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '0b8d264e4624'
down_revision: Union[str, Sequence[str], None] = 'c4f7a2d91e3b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MEETING_FACT = """
CREATE OR REPLACE VIEW kpi.meeting_fact AS
SELECT m.ended_at, e.extracted_at, m.source, m.status,
  CASE WHEN m.status <> 'failed' THEN NULL
       WHEN m.failed_stage IN ('stt','sources','extract','handoff','diarize',
            'speaker_assignment_expired','upload_unclaimed','chat_stalled') THEN m.failed_stage
       ELSE 'other' END                                   AS failed_stage,
  EXISTS (SELECT 1 FROM meeting r WHERE r.replaces_meeting_id = m.meeting_id) AS replaced,
  round(m.duration_ms / 60000.0, 1)                       AS meeting_minutes,
  EXTRACT(EPOCH FROM e.extracted_at - CASE
    WHEN m.source = 'discord' AND m.duration_ms IS NOT NULL
      THEN {discord_end}
    ELSE m.ended_at END)                                AS processing_seconds,
  EXTRACT(EPOCH FROM u.speakers_assigned_at - u.speakers_reported_at) AS speaker_wait_seconds
FROM meeting m
LEFT JOIN LATERAL (SELECT min(x.created_at) AS extracted_at FROM extraction x
                   WHERE x.meeting_id = m.meeting_id) e ON true
LEFT JOIN meeting_upload u ON u.meeting_id = m.meeting_id
WHERE m.deleted_at IS NULL AND m.ended_at IS NOT NULL
  AND m.workspace_id NOT IN (SELECT workspace_id FROM kpi.excluded_workspace)
"""

# 디스코드 회의의 ended_at 은 워커가 처리를 시작한 시각이라 큐 대기가 빠진다. 녹음 끝(마지막 발화 끝)부터 재되,
# 교체 회의처럼 started_at 이 늦게 찍힌 회의는 녹음 끝이 ended_at 을 넘으므로 ended_at 으로 자른다.
CAPPED_END = "LEAST(m.started_at + m.duration_ms * INTERVAL '1 millisecond', m.ended_at)"
UNCAPPED_END = "m.started_at + m.duration_ms * INTERVAL '1 millisecond'"


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(MEETING_FACT.format(discord_end=CAPPED_END))


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute(MEETING_FACT.format(discord_end=UNCAPPED_END))
