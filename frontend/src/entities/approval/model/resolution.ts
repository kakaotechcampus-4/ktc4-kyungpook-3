import { isDateOnly } from '@/shared/lib/date'
import type { Approval } from './types'

/**
 * 승인 처리 요청이 가는 곳. `msw` 는 개발 모의 서버, `live` 는 실 API 다.
 * 미합의 보완 입력(`task_overrides`)은 `msw` 에서만 보낸다. 모르거나 빠진 값은 `live` 로 본다
 */
export type ApprovalTransport = 'live' | 'msw'

export function toApprovalTransport(value: unknown): ApprovalTransport {
  return value === 'msw' ? 'msw' : 'live'
}

export type ApprovalDecision = 'approved' | 'rejected'

/** 생성 승인에서 확정할 세 값. 폼 상태를 그대로 넘길 수 있게 담당자·마감은 비어 있을 수 있다 */
export interface TaskCreateFields {
  taskTitle: string
  assigneeMemberId: string | null
  dueDate: string | null
}

/** 생성 승인의 필수값 중 충족하지 못한 것 */
export type TaskCreateIssue = 'title' | 'assignee' | 'due'

/** 서버 TaskCreateRequest.title 의 max_length. Python 의 글자 수(코드 포인트)로 센다 */
export const TASK_TITLE_MAX_LENGTH = 300

/**
 * 처리 내용. 서버로 보낼 본문의 도메인 모양이다. 처리자는 없다 — 서버가 세션으로 정한다.
 * `taskOverrides` 는 미합의 요청안이라 MSW 의 approved task_create 에서만 채워진다
 */
export type ApprovalResolution =
  | { status: 'rejected' }
  | {
      status: 'approved'
      confirmTaskVersion?: number
      taskOverrides?: { taskTitle: string; assigneeMemberId: string; dueDate: string }
    }

export interface ApprovalResolveContext {
  /** `msw` 가 아니면(빠짐·모르는 값 포함) `live` 로 본다 */
  transport?: unknown
  /** 현재 공간의 팀원 ID. 생성 승인의 담당자가 여기에 있어야 한다 */
  memberIds?: readonly string[]
  /** 생성 승인 보완값. `msw` 에서만 쓴다. `live` 에서는 넘겨도 판정과 본문에서 무시한다 */
  overrides?: TaskCreateFields | null
  /** task_update 재승인에서만. 409 APPROVAL_CONFLICT 가 돌려준 서버 버전이다 */
  confirmTaskVersion?: number | null
}

export type ApprovalResolutionPlan =
  | { ok: true; resolution: ApprovalResolution }
  | { ok: false; reason: string; issues: TaskCreateIssue[] }

const ISSUE_LABELS: Record<TaskCreateIssue, string> = {
  title: '제목',
  assignee: '담당자',
  due: '마감',
}

export const APPROVAL_RESOLUTION_REASONS = {
  resolved: '이미 처리된 확인 요청이에요.',
  unsupported: '지원하지 않는 확인 요청이라 여기서 처리할 수 없어요.',
  liveOverridesUnsupported: '지금 서버는 승인 전 보완을 지원하지 않아요.',
} as const

/** 제목은 앞뒤 공백을 뺀 1~300자, 담당자는 현재 공간 팀원, 마감은 달력에 있는 `YYYY-MM-DD` */
export function validateTaskCreateFields(
  fields: TaskCreateFields,
  memberIds: readonly string[],
): TaskCreateIssue[] {
  const issues: TaskCreateIssue[] = []
  const titleLength = [...fields.taskTitle.trim()].length
  if (titleLength < 1 || titleLength > TASK_TITLE_MAX_LENGTH) issues.push('title')
  if (fields.assigneeMemberId === null || !memberIds.includes(fields.assigneeMemberId))
    issues.push('assignee')
  if (fields.dueDate === null || !isDateOnly(fields.dueDate)) issues.push('due')
  return issues
}

function issueReason(issues: readonly TaskCreateIssue[], transport: ApprovalTransport): string {
  const base = `승인하려면 ${issues.map((issue) => ISSUE_LABELS[issue]).join('·')} 정보를 올바르게 채워야 해요.`
  return transport === 'live'
    ? `${base} ${APPROVAL_RESOLUTION_REASONS.liveOverridesUnsupported}`
    : base
}

function notResolvable(issues: TaskCreateIssue[], reason: string): ApprovalResolutionPlan {
  return { ok: false, reason, issues }
}

/**
 * 승인·반려 본문을 만들 수 있는지 판정한다. 화면은 실패 이유를 버튼 가까이에 보여 준다.
 * - 대기 중이 아니거나 지원하지 않는 종류면 승인·반려 모두 만들지 않는다
 * - 반려는 필수값과 무관하게 만들 수 있고 다른 입력을 싣지 않는다
 * - 생성 승인 승인은 확정할 세 값이 모두 유효할 때만 만든다. `live` 는 기존 값으로만 판정하고 보완값을 싣지 않는다.
 *   `msw` 는 보완값이 있으면 그 값으로 판정하고 그대로 싣는다
 * - 변경 승인 승인은 보완값 없이, 호출자가 서버 버전을 줄 때만 `confirmTaskVersion` 을 싣는다
 */
export function planApprovalResolution(
  approval: Approval,
  decision: ApprovalDecision,
  context: ApprovalResolveContext = {},
): ApprovalResolutionPlan {
  if (approval.status !== 'pending') return notResolvable([], APPROVAL_RESOLUTION_REASONS.resolved)
  if (approval.kind === 'unsupported')
    return notResolvable([], APPROVAL_RESOLUTION_REASONS.unsupported)
  if (decision === 'rejected') return { ok: true, resolution: { status: 'rejected' } }

  if (approval.kind === 'task_update') {
    const version = context.confirmTaskVersion
    return {
      ok: true,
      resolution:
        typeof version === 'number' && Number.isInteger(version) && version >= 1
          ? { status: 'approved', confirmTaskVersion: version }
          : { status: 'approved' },
    }
  }

  const transport = toApprovalTransport(context.transport)
  const overrides = transport === 'msw' ? (context.overrides ?? null) : null
  const fields: TaskCreateFields = overrides ?? {
    taskTitle: approval.title,
    assigneeMemberId: approval.assigneeMemberId,
    dueDate: approval.dueDate,
  }
  const issues = validateTaskCreateFields(fields, context.memberIds ?? [])
  if (issues.length > 0) return notResolvable(issues, issueReason(issues, transport))
  if (overrides === null) return { ok: true, resolution: { status: 'approved' } }
  return {
    ok: true,
    resolution: {
      status: 'approved',
      taskOverrides: {
        taskTitle: overrides.taskTitle.trim(),
        // validateTaskCreateFields 가 null 을 이슈로 걸렀다
        assigneeMemberId: overrides.assigneeMemberId as string,
        dueDate: overrides.dueDate as string,
      },
    },
  }
}
