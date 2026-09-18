import type { ApprovalDto } from '@/shared/types/api/approval'
import { extractionFixtures } from './extraction'

export const approvalFixtures: ApprovalDto[] = extractionFixtures[1].items
  .slice(3)
  .map((item, index) => ({
    approval_id: `ap_0${index + 1}`,
    workspace_id: 'ws_01',
    type: 'task_create',
    payload: {
      task_title: item.task.title,
      assignee_member_id: item.assignee.member_id,
      assignee_raw: item.assignee.raw,
      due_date: item.due_date.value,
      due_raw: index === 0 ? '다음 주 월요일' : item.due_date.raw,
      evidence_quote: item.evidence.quote,
      evidence_speaker: item.evidence.speaker,
      evidence_at_ms: item.evidence.at_ms,
      extraction_item_id: item.item_id,
      meeting_id: 'mt_09',
      gate: item.gate,
    },
    related_task_id: null,
    requested_by: null,
    status: 'pending',
    resolved_by: null,
    created_at: ['2026-09-15T06:00:00Z', '2026-09-15T06:01:00Z', '2026-09-17T02:00:00Z'][index],
    resolved_at: null,
  }))
