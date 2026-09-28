import type { ApprovalDto } from '@/shared/types/api/approval'
import { enumValue } from '@/shared/lib/enum'
import type { Approval, ApprovalMissing } from './types'

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}
/** 근거: docs/impl-decision/2026-09-18-nullable-extraction-evidence.md */
export function toApproval(dto: ApprovalDto): Approval {
  const base = {
    id: dto.approval_id,
    workspaceId: dto.workspace_id,
    status: enumValue(
      dto.status,
      ['pending', 'approved', 'rejected'] as const,
      'pending',
      'approval status',
    ),
    relatedTaskId: dto.related_task_id,
    requestedBy: dto.requested_by,
    resolvedBy: dto.resolved_by,
    createdAt: dto.created_at,
    resolvedAt: dto.resolved_at,
  }
  const payload = dto.payload
  if (dto.type === 'task_create') {
    const assigneeMemberId = text(payload.assignee_member_id)
    const dueDate = text(payload.due_date)
    const missing: ApprovalMissing[] = []
    if (assigneeMemberId === null) missing.push('assignee')
    if (dueDate === null) missing.push('due')
    const gate = payload.gate === 'review' || payload.gate === 'hold' ? payload.gate : null
    if (gate === null && typeof payload.gate === 'string' && import.meta.env.DEV)
      console.warn(`Unknown approval gate: ${payload.gate}`)
    return {
      ...base,
      kind: 'task_create',
      title: text(payload.task_title) || text(payload.title) || '',
      assigneeMemberId,
      assigneeRaw: text(payload.assignee_raw),
      dueDate,
      dueRaw: text(payload.due_raw),
      missing,
      evidence: {
        quote: text(payload.evidence_quote),
        speaker: text(payload.evidence_speaker),
        atMs:
          typeof payload.evidence_at_ms === 'number' && Number.isFinite(payload.evidence_at_ms)
            ? payload.evidence_at_ms
            : null,
      },
      meetingId: text(payload.meeting_id),
      extractionItemId: text(payload.extraction_item_id),
      gate,
    }
  }
  if (dto.type === 'task_update')
    return {
      ...base,
      kind: 'task_update',
      title: text(payload.title),
      changes: Object.entries(payload)
        .filter(([field]) =>
          ['title', 'assignee_member_id', 'status', 'progress', 'blocker', 'due_date'].includes(
            field,
          ),
        )
        .map(([field, value]) => ({ field, value })),
    }
  return { ...base, kind: 'unsupported', type: dto.type }
}
