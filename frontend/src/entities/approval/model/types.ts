import type { ExtractionEvidence } from '@/shared/types/common'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type ApprovalMissing = 'assignee' | 'due'
interface ApprovalBase {
  id: string
  workspaceId: string
  status: ApprovalStatus
  relatedTaskId: string | null
  requestedBy: string | null
  resolvedBy: string | null
  createdAt: string
  resolvedAt: string | null
}
export interface TaskCreateApproval extends ApprovalBase {
  kind: 'task_create'
  title: string
  assigneeMemberId: string | null
  assigneeRaw: string | null
  dueDate: string | null
  dueRaw: string | null
  missing: ApprovalMissing[]
  evidence: ExtractionEvidence
  meetingId: string | null
  extractionItemId: string | null
  gate: 'review' | 'hold' | null
}
export interface TaskUpdateApproval extends ApprovalBase {
  kind: 'task_update'
  title: string | null
  changes: { field: string; value: unknown }[]
}
export interface UnsupportedApproval extends ApprovalBase {
  kind: 'unsupported'
  type: string
}
export type Approval = TaskCreateApproval | TaskUpdateApproval | UnsupportedApproval

/** 서버 `_find_conflicts` 의 한 항목. 제안할 때 비교한 값·지금 값·제안 값이다 */
export interface ApprovalConflict {
  field: string
  base: unknown
  current: unknown
  proposed: unknown
}

/**
 * 승인 처리에서 화면이 따로 다루는 실패.
 * - `conflict`: task_update 제안 뒤 같은 필드가 바뀌었다. PM 이 확인하고 다시 승인하면 `taskVersion` 을 보낸다
 * - `already_resolved`: 다른 처리가 먼저 끝났다. 재처리하지 않고 현재 상태를 보여 준다
 */
export type ApprovalResolveFailure =
  | {
      kind: 'conflict'
      approvalId: string
      taskId: string
      taskVersion: number
      conflicts: ApprovalConflict[]
    }
  | { kind: 'already_resolved'; approvalId: string | null; currentStatus: ApprovalStatus | null }
