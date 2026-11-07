import { ApiError, ERROR_CODES, CLIENT_ERROR_CODES, createClientError } from '@/shared/api/errors'
import type { ApprovalDto, ApprovalResolveRequestDto } from '@/shared/types/api/approval'
import { enumValue } from '@/shared/lib/enum'
import { z } from 'zod'
import type { ApprovalResolution } from './resolution'
import type { ExtractionEvidence } from '@/shared/types/common'
import type {
  Approval,
  ApprovalConflict,
  ApprovalMissing,
  ApprovalResolveFailure,
  ApprovalStatus,
  TaskUpdateCategory,
} from './types'

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function evidence(payload: Record<string, unknown>): ExtractionEvidence {
  return {
    quote: text(payload.evidence_quote),
    speaker: text(payload.evidence_speaker),
    speakerMemberId: text(payload.evidence_speaker_member_id),
    atMs:
      typeof payload.evidence_at_ms === 'number' && Number.isFinite(payload.evidence_at_ms)
        ? payload.evidence_at_ms
        : null,
  }
}

const taskUpdateCategories: readonly TaskUpdateCategory[] = [
  'schedule',
  'assignee',
  'status',
  'scope',
  'decision',
  'none',
]

/** 모르는 분류는 어느 것으로도 추정하지 않고 null 로 둔다 */
function taskUpdateCategory(value: unknown): TaskUpdateCategory | null {
  if ((taskUpdateCategories as readonly unknown[]).includes(value))
    return value as TaskUpdateCategory
  if (typeof value === 'string' && import.meta.env.DEV)
    console.warn(`Unknown approval category: ${value}`)
  return null
}

/** 범위 변경은 바꿀 필드가 없어도 승인 요청이 된다 (#205). 화면은 모두 이 판정을 쓴다 */
export function isScopeChange(approval: Approval): boolean {
  return approval.kind === 'task_update' && approval.category === 'scope'
}

const createOverridesSchema = z.object({
  task_title: z.string().optional(),
  assignee_member_id: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
})
const updateOverridesSchema = z.object({
  status: z.enum(['todo', 'in_progress', 'blocked', 'done']).optional(),
  due_date: z.string().nullable().optional(),
})

function storedCreateOverrides(value: unknown) {
  if (value === undefined) return {}
  const result = createOverridesSchema.safeParse(value)
  if (!result.success) throw createClientError(CLIENT_ERROR_CODES.INVALID_RESPONSE)
  const parsed = result.data
  return {
    ...(parsed.task_title !== undefined ? { taskTitle: parsed.task_title } : {}),
    ...(parsed.assignee_member_id !== undefined
      ? { assigneeMemberId: parsed.assignee_member_id }
      : {}),
    ...(parsed.due_date !== undefined ? { dueDate: parsed.due_date } : {}),
  }
}
function storedUpdateOverrides(value: unknown) {
  if (value === undefined) return {}
  const result = updateOverridesSchema.safeParse(value)
  if (!result.success) throw createClientError(CLIENT_ERROR_CODES.INVALID_RESPONSE)
  const parsed = result.data
  return {
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    ...(parsed.due_date !== undefined ? { dueDate: parsed.due_date } : {}),
  }
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
      storedOverrides: storedCreateOverrides(payload.task_overrides),
      title: text(payload.task_title) || text(payload.title) || '',
      assigneeMemberId,
      assigneeRaw: text(payload.assignee_raw),
      dueDate,
      dueRaw: text(payload.due_raw),
      missing,
      evidence: evidence(payload),
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
      storedOverrides: storedUpdateOverrides(payload.task_overrides),
      title: text(payload.task_title) || text(payload.base_title) || null,
      changes: Object.entries(payload)
        .filter(([field]) =>
          ['title', 'assignee_member_id', 'status', 'blocker', 'due_date'].includes(field),
        )
        .map(([field, value]) => ({ field, value })),
      category: taskUpdateCategory(payload.category),
      docText: text(payload.doc_text) || null,
      evidence: evidence(payload),
      meetingId: text(payload.meeting_id),
      replyMessageId:
        payload.change_source === 'reminder_reply' ? text(payload.reply_message_id) : null,
    }
  return { ...base, kind: 'unsupported', type: dto.type }
}

export function toApprovalResolveRequestDto(
  resolution: ApprovalResolution,
): ApprovalResolveRequestDto {
  if (resolution.status === 'rejected') return { status: 'rejected' }
  const body: ApprovalResolveRequestDto = { status: 'approved' }
  if (resolution.kind === 'task_update') {
    if (resolution.confirmTaskVersion !== undefined)
      body.confirm_task_version = resolution.confirmTaskVersion
    const edits = resolution.taskOverrides
    if (edits)
      body.task_overrides = {
        ...(edits.status !== undefined ? { status: edits.status } : {}),
        ...(edits.dueDate !== undefined ? { due_date: edits.dueDate } : {}),
      }
  } else {
    const edits = resolution.taskOverrides
    if (edits)
      body.task_overrides = {
        ...(edits.taskTitle !== undefined ? { task_title: edits.taskTitle } : {}),
        ...(edits.assigneeMemberId !== undefined
          ? { assignee_member_id: edits.assigneeMemberId }
          : {}),
        ...(edits.dueDate !== undefined ? { due_date: edits.dueDate } : {}),
      }
  }
  if (body.task_overrides && Object.keys(body.task_overrides).length === 0)
    delete body.task_overrides
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
