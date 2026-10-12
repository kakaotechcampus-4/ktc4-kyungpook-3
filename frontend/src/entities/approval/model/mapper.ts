import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import type { ApprovalDto, ApprovalResolveRequestDto } from '@/shared/types/api/approval'
import { enumValue } from '@/shared/lib/enum'
import { toApprovalTransport } from './resolution'
import type { ApprovalResolution } from './resolution'
import type {
  Approval,
  ApprovalConflict,
  ApprovalMissing,
  ApprovalResolveFailure,
  ApprovalStatus,
} from './types'

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
  // 대상 태스크 이름은 `task_title`(없으면 제안 때 본 `base_title`)이다. `title` 은 바꿀 제목이라 이름으로 쓰지 않는다
  // (backend extractions.py 수정안 payload)
  if (dto.type === 'task_update')
    return {
      ...base,
      kind: 'task_update',
      title: text(payload.task_title) || text(payload.base_title) || null,
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

/**
 * 처리 내용을 `PATCH /approvals/{approval_id}` 본문으로 바꾼다. 처리자(`resolved_by`)는 넣지 않는다.
 * `task_overrides` 는 `msw` 일 때만 싣는다 — 처리 내용에 들어 있어도 `live`·모르는 값이면 버린다.
 * 반려 본문은 `status` 뿐이다
 */
export function toApprovalResolveRequestDto(
  resolution: ApprovalResolution,
  transport: unknown,
): ApprovalResolveRequestDto {
  if (resolution.status === 'rejected') return { status: 'rejected' }
  const body: ApprovalResolveRequestDto = { status: 'approved' }
  if (resolution.confirmTaskVersion !== undefined)
    body.confirm_task_version = resolution.confirmTaskVersion
  if (resolution.taskOverrides !== undefined && toApprovalTransport(transport) === 'msw')
    body.task_overrides = {
      task_title: resolution.taskOverrides.taskTitle,
      assignee_member_id: resolution.taskOverrides.assigneeMemberId,
      due_date: resolution.taskOverrides.dueDate,
    }
  return body
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toConflict(value: unknown): ApprovalConflict | null {
  if (!isRecord(value) || typeof value.field !== 'string') return null
  if (!('base' in value) || !('current' in value) || !('proposed' in value)) return null
  return { field: value.field, base: value.base, current: value.current, proposed: value.proposed }
}

/**
 * 승인 처리 실패 중 화면이 따로 다룰 두 가지를 읽는다. 나머지(권한·검증·네트워크)는 null 이다.
 * - 409 APPROVAL_CONFLICT: `details.task_version` 과 `details.conflicts[]`(field·base·current·proposed).
 *   모양이 틀리면 재승인 기준이 없으므로 null 이다
 * - 409 APPROVAL_ALREADY_RESOLVED: `details.current_status`. 모르는 값이면 null 로 둔다
 */
export function toApprovalResolveFailure(error: unknown): ApprovalResolveFailure | null {
  if (!(error instanceof ApiError) || error.kind !== 'http' || error.status !== 409) return null
  const details = error.details
  if (error.code === ERROR_CODES.APPROVAL_CONFLICT) {
    if (
      !isRecord(details) ||
      typeof details.approval_id !== 'string' ||
      typeof details.task_id !== 'string' ||
      typeof details.task_version !== 'number' ||
      !Number.isInteger(details.task_version) ||
      details.task_version < 1 ||
      !Array.isArray(details.conflicts)
    )
      return null
    const conflicts = details.conflicts.map(toConflict)
    if (conflicts.some((conflict) => conflict === null)) return null
    return {
      kind: 'conflict',
      approvalId: details.approval_id,
      taskId: details.task_id,
      taskVersion: details.task_version,
      conflicts: conflicts as ApprovalConflict[],
    }
  }
  if (error.code === 'APPROVAL_ALREADY_RESOLVED') {
    const statuses: readonly ApprovalStatus[] = ['pending', 'approved', 'rejected']
    const current = isRecord(details) ? details.current_status : undefined
    return {
      kind: 'already_resolved',
      approvalId:
        isRecord(details) && typeof details.approval_id === 'string' ? details.approval_id : null,
      currentStatus: (statuses as readonly unknown[]).includes(current)
        ? (current as ApprovalStatus)
        : null,
    }
  }
  return null
}
