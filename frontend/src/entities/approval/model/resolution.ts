import { isDateOnly } from '@/shared/lib/date'
import type { TaskStatus } from '@/shared/types/common'
import type { Approval, TaskCreateApproval, TaskUpdateApproval } from './types'

export type ApprovalDecision = 'approved' | 'rejected'
export interface TaskCreateFields {
  taskTitle: string
  assigneeMemberId: string | null
  dueDate: string | null
}
export type TaskCreateEdits = Partial<TaskCreateFields>
/** `assigneeMemberId` 는 담당자를 찾지 못한 답장 카드(`assigneePick`)에서만 고른다. null 은 미정이다 */
export type TaskUpdateEdits = Partial<{
  status: TaskStatus
  dueDate: string | null
  assigneeMemberId: string | null
}>
export type ApprovalEdits =
  | { kind: 'task_create'; values: TaskCreateEdits; saveAlias?: boolean }
  | { kind: 'task_update'; values: TaskUpdateEdits }
export type TaskCreateIssue = 'title' | 'assignee' | 'due'
export const TASK_TITLE_MAX_LENGTH = 300
export type ApprovalResolution =
  | { status: 'rejected' }
  | { status: 'approved'; kind: 'task_create'; taskOverrides?: TaskCreateEdits; saveAlias?: true }
  | {
      status: 'approved'
      kind: 'task_update'
      taskOverrides?: TaskUpdateEdits
      confirmTaskVersion?: number
    }

export interface ApprovalResolveContext {
  memberIds?: readonly string[]
  edits?: ApprovalEdits | null
  confirmTaskVersion?: number | null
}
export type ApprovalResolutionPlan =
  | { ok: true; resolution: ApprovalResolution }
  | { ok: false; reason: string; issues: TaskCreateIssue[] }

export const ASSIGNEE_PICK_REASON = '담당자를 골라 주세요.'

export const APPROVAL_RESOLUTION_REASONS = {
  resolved: '이미 처리된 확인 요청이에요.',
  unsupported: '지원하지 않는 확인 요청이라 여기서 처리할 수 없어요.',
} as const

export function taskCreateValues(
  approval: TaskCreateApproval,
  edits: TaskCreateEdits = {},
): TaskCreateFields {
  return {
    taskTitle: approval.title,
    assigneeMemberId: approval.assigneeMemberId,
    dueDate: approval.dueDate,
    ...(edits.taskTitle !== undefined ? { taskTitle: edits.taskTitle } : {}),
    ...(edits.assigneeMemberId !== undefined ? { assigneeMemberId: edits.assigneeMemberId } : {}),
    ...(edits.dueDate !== undefined ? { dueDate: edits.dueDate } : {}),
  }
}

/**
 * 이 값으로 승인하면 담당자의 별칭으로 등록할 글자 (#523). 담당자가 미정이면 등록할 사람이 없어 null 이다.
 * 승인 본문의 `save_alias` 와 화면의 등록 체크박스가 모두 이 판정을 쓴다
 */
export function aliasToLearn(
  approval: TaskCreateApproval,
  fields: TaskCreateFields,
): string | null {
  return fields.assigneeMemberId === null ? null : approval.aliasCandidate
}

export function taskUpdateChanges(approval: TaskUpdateApproval, edits: TaskUpdateEdits = {}) {
  const changes = new Map(approval.changes.map(({ field, value }) => [field, value]))
  if (edits.status !== undefined) changes.set('status', edits.status)
  if (edits.dueDate !== undefined) changes.set('due_date', edits.dueDate)
  if (edits.assigneeMemberId !== undefined)
    changes.set('assignee_member_id', edits.assigneeMemberId)
  return Array.from(changes, ([field, value]) => ({ field, value }))
}

export function validateTaskCreateFields(
  fields: TaskCreateFields,
  memberIds: readonly string[],
): TaskCreateIssue[] {
  const issues: TaskCreateIssue[] = []
  const titleLength = [...fields.taskTitle.trim()].length
  if (titleLength < 1 || titleLength > TASK_TITLE_MAX_LENGTH) issues.push('title')
  if (fields.assigneeMemberId !== null && !memberIds.includes(fields.assigneeMemberId))
    issues.push('assignee')
  if (fields.dueDate !== null && !isDateOnly(fields.dueDate)) issues.push('due')
  return issues
}

export function planApprovalResolution(
  approval: Approval,
  decision: ApprovalDecision,
  context: ApprovalResolveContext = {},
): ApprovalResolutionPlan {
  if (approval.status !== 'pending')
    return { ok: false, issues: [], reason: APPROVAL_RESOLUTION_REASONS.resolved }
  if (approval.kind === 'unsupported')
    return { ok: false, issues: [], reason: APPROVAL_RESOLUTION_REASONS.unsupported }
  if (decision === 'rejected') return { ok: true, resolution: { status: 'rejected' } }
  if (context.edits && context.edits.kind !== approval.kind)
    return { ok: false, issues: [], reason: '확인 요청 종류와 보완 값이 달라요.' }
  if (approval.kind === 'task_update') {
    const edits = context.edits?.kind === 'task_update' ? context.edits.values : {}
    if (
      (edits.dueDate !== undefined && edits.dueDate !== null && !isDateOnly(edits.dueDate)) ||
      (edits.status !== undefined &&
        !['todo', 'in_progress', 'blocked', 'done'].includes(edits.status))
    )
      return { ok: false, issues: [], reason: '상태와 마감 날짜를 올바르게 입력해 주세요.' }
    if (approval.assigneePick !== null && edits.assigneeMemberId === undefined)
      return { ok: false, issues: ['assignee'], reason: ASSIGNEE_PICK_REASON }
    if (
      typeof edits.assigneeMemberId === 'string' &&
      !(context.memberIds ?? []).includes(edits.assigneeMemberId)
    )
      return { ok: false, issues: ['assignee'], reason: '담당자를 팀원 중에서 골라 주세요.' }
    const version = context.confirmTaskVersion
    return {
      ok: true,
      resolution: {
        status: 'approved',
        kind: 'task_update',
        ...(Object.keys(edits).length ? { taskOverrides: edits } : {}),
        ...(typeof version === 'number' && Number.isInteger(version) && version >= 1
          ? { confirmTaskVersion: version }
          : {}),
      },
    }
  }
  const createEdits = context.edits?.kind === 'task_create' ? context.edits : null
  const edits = createEdits?.values ?? {}
  const fields = taskCreateValues(approval, edits)
  const issues = validateTaskCreateFields(fields, context.memberIds ?? [])
  if (issues.length)
    return {
      ok: false,
      issues,
      reason: `승인하려면 ${issues.map((issue) => ({ title: '제목', assignee: '담당자', due: '마감' })[issue]).join('·')} 정보를 올바르게 채워야 해요.`,
    }
  return {
    ok: true,
    resolution: {
      status: 'approved',
      kind: 'task_create',
      ...(Object.keys(edits).length
        ? {
            taskOverrides: {
              ...edits,
              ...(edits.taskTitle !== undefined ? { taskTitle: edits.taskTitle.trim() } : {}),
            },
          }
        : {}),
      ...(createEdits?.saveAlias === true && aliasToLearn(approval, fields) !== null
        ? { saveAlias: true }
        : {}),
    },
  }
}
