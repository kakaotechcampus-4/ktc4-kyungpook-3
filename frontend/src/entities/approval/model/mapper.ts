import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import {
  approvalAlreadyResolvedDetailsSchema,
  approvalConflictDetailsSchema,
} from '@/shared/types/api/approval'
import type { ApprovalDto, ApprovalResolveRequestDto } from '@/shared/types/api/approval'
import type { ApprovalResolution } from './resolution'
import type { ExtractionEvidence } from '@/shared/types/common'
import type {
  Approval,
  ApprovalMissing,
  ApprovalResolveFailure,
  MergedApprovalItem,
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

/** 합쳐진 항목 하나는 근거 키를 payload 와 같은 이름으로 담는다 (backend services/pending_merge.py) */
function mergedItems(items: readonly Record<string, unknown>[]): MergedApprovalItem[] {
  return items.map((item) => ({
    extractionItemId: text(item.extraction_item_id),
    meetingId: text(item.meeting_id),
    evidence: evidence(item),
    docText: text(item.doc_text) || null,
    mergedAt: text(item.merged_at),
  }))
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

type StoredOverrides = NonNullable<ApprovalDto['payload']['task_overrides']>

function storedCreateOverrides(parsed: StoredOverrides = {}) {
  return {
    ...(parsed.task_title !== undefined ? { taskTitle: parsed.task_title } : {}),
    ...(parsed.assignee_member_id !== undefined
      ? { assigneeMemberId: parsed.assignee_member_id }
      : {}),
    ...(parsed.due_date !== undefined ? { dueDate: parsed.due_date } : {}),
  }
}
function storedUpdateOverrides(parsed: StoredOverrides = {}) {
  return {
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    ...(parsed.due_date !== undefined ? { dueDate: parsed.due_date } : {}),
    ...(parsed.assignee_member_id !== undefined
      ? { assigneeMemberId: parsed.assignee_member_id }
      : {}),
  }
}

/**
 * 답장이 말한 담당자를 팀원에서 찾지 못한 카드 (BE #460). 분류는 보지 않는다 — 상태와 담당자가 섞인 카드는
 * 분류가 첫 줄을 따라 다른 값이 된다
 */
function assigneePick(payload: Record<string, unknown>): { raw: string } | null {
  const raw = text(payload.assignee_raw)
  return text(payload.reply_message_id) !== null &&
    !Object.hasOwn(payload, 'assignee_member_id') &&
    raw !== null &&
    raw.trim() !== ''
    ? { raw }
    : null
}

/** 근거: docs/impl-decision/2026-09-18-nullable-extraction-evidence.md */
export function toApproval(dto: ApprovalDto): Approval {
  const base = {
    id: dto.approval_id,
    workspaceId: dto.workspace_id,
    status: dto.status,
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
      aliasCandidate:
        dto.alias_candidate === true && dto.alias_text?.trim() ? dto.alias_text : null,
      payloadVersion: dto.payload_version || null,
      mergedItems: mergedItems(payload.merged_items ?? []),
      assigneeItemId: payload.assignee_item_id || text(payload.extraction_item_id),
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
      assigneePick: assigneePick(payload),
    }
  return { ...base, kind: 'unsupported', type: dto.type }
}

export function toApprovalResolveRequestDto(
  resolution: ApprovalResolution,
): ApprovalResolveRequestDto {
  const seen =
    resolution.status === 'rejected' || resolution.kind === 'task_create'
      ? resolution.payloadVersion
      : undefined
  const version = seen === undefined ? {} : { payload_version: seen }
  if (resolution.status === 'rejected') return { status: 'rejected', ...version }
  const body: ApprovalResolveRequestDto = { status: 'approved', ...version }
  if (resolution.kind === 'task_update') {
    if (resolution.confirmTaskVersion !== undefined)
      body.confirm_task_version = resolution.confirmTaskVersion
    const edits = resolution.taskOverrides
    if (edits)
      body.task_overrides = {
        ...(edits.status !== undefined ? { status: edits.status } : {}),
        ...(edits.dueDate !== undefined ? { due_date: edits.dueDate } : {}),
        ...(edits.assigneeMemberId !== undefined
          ? { assignee_member_id: edits.assigneeMemberId }
          : {}),
      }
  } else {
    if (resolution.saveAlias) body.save_alias = true
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

/**
 * 승인 처리 실패 중 화면이 따로 다룰 세 가지를 읽는다. 나머지(권한·검증·네트워크)는 null 이다.
 * - 409 APPROVAL_CONFLICT: `details.task_version` 과 `details.conflicts[]`(field·base·current·proposed). 스키마로 읽는다.
 *   모양이 틀리면 재승인 기준이 없으므로 null 이다
 * - 409 APPROVAL_CHANGED: 본 뒤 카드가 바뀌었다. 어느 칸인지는 서버가 주지 않아 화면이 새 카드와 비교한다
 * - 409 APPROVAL_ALREADY_RESOLVED: `details.current_status`. 모르는 값이면 null 로 둔다
 */
export function toApprovalResolveFailure(error: unknown): ApprovalResolveFailure | null {
  if (!(error instanceof ApiError) || error.kind !== 'http' || error.status !== 409) return null
  const details = error.details
  if (error.code === ERROR_CODES.APPROVAL_CONFLICT) {
    const parsed = approvalConflictDetailsSchema.safeParse(details)
    if (!parsed.success) return null
    return {
      kind: 'conflict',
      approvalId: parsed.data.approval_id,
      taskId: parsed.data.task_id,
      taskVersion: parsed.data.task_version,
      conflicts: parsed.data.conflicts,
    }
  }
  if (error.code === ERROR_CODES.APPROVAL_CHANGED) return { kind: 'changed' }
  if (error.code === 'APPROVAL_ALREADY_RESOLVED') {
    const parsed = approvalAlreadyResolvedDetailsSchema.safeParse(details)
    return {
      kind: 'already_resolved',
      approvalId: parsed.success ? parsed.data.approval_id : null,
      currentStatus: parsed.success ? parsed.data.current_status : null,
    }
  }
  return null
}
