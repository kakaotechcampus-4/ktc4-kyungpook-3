"""add kpi views

Grafana Cloud 대시보드(#675)가 읽는 kpi 스키마를 만든다. 읽기 계정은 view 3개에만 SELECT 를 받아 원본 표에는
닿지 않는다.

- kpi.meeting_fact: 회의 한 건(삭제·종료 시각 없음 제외). 처리 시간·실패 단계·재시도 여부.
- kpi.extraction_item_fact: 추출 항목 한 건(삭제된 회의 제외). 게이트·되돌림.
- kpi.approval_fact: 승인 요청 한 건. 만든 경로·결과·응답 시간·전사 오인식 표시.
- kpi.excluded_workspace: 시험용(시드) 워크스페이스를 세 view 에서 뺄 때 쓰는 빈 표. 운영 SQL 로 채운다.

view 에는 ID·제목·본문·payload·이름·이메일 컬럼을 두지 않는다. payload 는 JSON 객체일 때만 읽어서 깨진 한 행이
조회 전체를 깨지 않게 한다. 이후 마이그레이션이 view 가 쓰는 컬럼을 지우거나 타입을 바꾸려면 PostgreSQL 이
거부하므로 그 마이그레이션에서 view 를 DROP 한 뒤 다시 만든다. `SELECT *` 는 쓰지 않고 쓰는 컬럼만 적어 그 밖의 컬럼은 자유롭게 바꿀 수 있게 한다(backend/README.md 의 "KPI view").

PostgreSQL 전용이다. 다른 DB 에서는 아무것도 하지 않는다.

Revision ID: c4f7a2d91e3b
Revises: 6631d28f2e1b
Create Date: 2026-11-11 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c4f7a2d91e3b'
down_revision: Union[str, Sequence[str], None] = '6631d28f2e1b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CREATE_SCHEMA = "CREATE SCHEMA IF NOT EXISTS kpi"

CREATE_EXCLUDED_WORKSPACE = "CREATE TABLE kpi.excluded_workspace (workspace_id varchar(36) PRIMARY KEY)"

CREATE_MEETING_FACT = """
CREATE VIEW kpi.meeting_fact AS
SELECT m.ended_at, e.extracted_at, m.source, m.status,
  CASE WHEN m.status <> 'failed' THEN NULL
       WHEN m.failed_stage IN ('stt','sources','extract','handoff','diarize',
            'speaker_assignment_expired','upload_unclaimed','chat_stalled') THEN m.failed_stage
       ELSE 'other' END                                   AS failed_stage,
  EXISTS (SELECT 1 FROM meeting r WHERE r.replaces_meeting_id = m.meeting_id) AS replaced,
  round(m.duration_ms / 60000.0, 1)                       AS meeting_minutes,
  -- 디스코드 회의의 ended_at 은 워커가 처리를 시작한 시각이라 큐 대기가 빠진다. 녹음 끝(마지막 발화 끝)부터 잰다.
  EXTRACT(EPOCH FROM e.extracted_at - CASE
    WHEN m.source = 'discord' AND m.duration_ms IS NOT NULL
      THEN m.started_at + m.duration_ms * INTERVAL '1 millisecond'
    ELSE m.ended_at END)                                AS processing_seconds,
  EXTRACT(EPOCH FROM u.speakers_assigned_at - u.speakers_reported_at) AS speaker_wait_seconds
FROM meeting m
LEFT JOIN LATERAL (SELECT min(x.created_at) AS extracted_at FROM extraction x
                   WHERE x.meeting_id = m.meeting_id) e ON true
LEFT JOIN meeting_upload u ON u.meeting_id = m.meeting_id
WHERE m.deleted_at IS NULL AND m.ended_at IS NOT NULL
  AND m.workspace_id NOT IN (SELECT workspace_id FROM kpi.excluded_workspace)
"""

CREATE_EXTRACTION_ITEM_FACT = """
CREATE VIEW kpi.extraction_item_fact AS
SELECT i.created_at, m.source AS meeting_source, x.extraction_path, i.action, i.gate,
  i.reverted_at IS NOT NULL                        AS reverted,
  EXTRACT(EPOCH FROM i.reverted_at - i.created_at) AS revert_after_seconds
FROM extraction_item i
JOIN extraction x ON x.extraction_id = i.extraction_id
JOIN meeting m ON m.meeting_id = x.meeting_id
WHERE m.deleted_at IS NULL
  AND m.workspace_id NOT IN (SELECT workspace_id FROM kpi.excluded_workspace)
"""

CREATE_APPROVAL_FACT = """
CREATE VIEW kpi.approval_fact AS
WITH a AS (
  SELECT r.type, r.status, r.requested_by, r.created_at, r.resolved_at,
         CASE WHEN r.payload IS JSON OBJECT AND strpos(r.payload, '\\u0000') = 0 THEN r.payload::jsonb END AS j
  FROM approval_request r
  WHERE r.workspace_id NOT IN (SELECT workspace_id FROM kpi.excluded_workspace))
SELECT a.created_at, a.resolved_at, a.type,
  CASE WHEN a.j -> 'reverted_task_id' IS NOT NULL THEN 'auto_revert'
       WHEN a.requested_by IS NOT NULL THEN 'manual'
       WHEN a.j ->> 'change_source' = 'reminder_reply' THEN 'reply'
       WHEN a.j -> 'extraction_item_id' IS NOT NULL THEN 'meeting'
       ELSE 'other' END                                   AS origin,
  m.source                                                AS meeting_source,
  CASE WHEN a.j ->> 'gate' IN ('review','hold') THEN a.j ->> 'gate' END AS card_gate,
  CASE WHEN a.status = 'pending' THEN 'pending'
       WHEN a.status = 'approved' AND a.j -> 'task_overrides' IS NOT NULL THEN 'approved_edited'
       WHEN a.status = 'approved' THEN 'approved'
       WHEN a.status = 'rejected' THEN 'rejected'
       ELSE 'other' END                                   AS outcome,
  EXTRACT(EPOCH FROM a.resolved_at - a.created_at)        AS response_seconds,
  CASE WHEN a.type <> 'task_create' OR jsonb_typeof(a.j -> 'asr_suspects') IS DISTINCT FROM 'array' THEN NULL
       WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(a.j -> 'asr_suspects') s
                    WHERE s ->> 'source' = 'check_failed') THEN 'check_failed'
       WHEN jsonb_array_length(a.j -> 'asr_suspects') > 0 THEN 'suspect'
       ELSE 'none' END                                    AS asr_flag,
  (a.j -> 'task_overrides' -> 'task_title') IS NOT NULL   AS title_edited
FROM a LEFT JOIN meeting m ON m.meeting_id = a.j ->> 'meeting_id'
WHERE a.j IS NOT NULL AND a.j -> 'source_deleted' IS NULL
"""


def upgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    for statement in (
        CREATE_SCHEMA,
        CREATE_EXCLUDED_WORKSPACE,
        CREATE_MEETING_FACT,
        CREATE_EXTRACTION_ITEM_FACT,
        CREATE_APPROVAL_FACT,
    ):
        op.execute(statement)


def downgrade() -> None:
    if op.get_bind().dialect.name != "postgresql":
        return
    op.execute("DROP VIEW IF EXISTS kpi.approval_fact")
    op.execute("DROP VIEW IF EXISTS kpi.extraction_item_fact")
    op.execute("DROP VIEW IF EXISTS kpi.meeting_fact")
    op.execute("DROP TABLE IF EXISTS kpi.excluded_workspace")
    op.execute("DROP SCHEMA IF EXISTS kpi CASCADE")
