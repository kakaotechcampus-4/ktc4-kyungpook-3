import type { TaskCreateEdits, TaskUpdateEdits } from './resolution'
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
  storedOverrides?: TaskCreateEdits
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
/** AI 판정 분류 (ai/shared/schemas.py JudgeCategory) */
export type TaskUpdateCategory = 'schedule' | 'assignee' | 'status' | 'scope' | 'decision' | 'none'
export interface TaskUpdateApproval extends ApprovalBase {
  kind: 'task_update'
  storedOverrides?: TaskUpdateEdits
  title: string | null
  changes: { field: string; value: unknown }[]
  /** 모르는 값이거나 없으면 null 이다 */
  category: TaskUpdateCategory | null
  docText: string | null
  evidence: ExtractionEvidence
  meetingId: string | null
  /** 리마인드 답장에서 온 제안이면 그 답장. 이때 meetingId 는 null 이고 근거는 답장 글이다 */
  replyMessageId: string | null
  /**
   * 답장이 말한 담당자를 팀원에서 찾지 못한 담당자 변경 카드. 제안에 담당자 값이 없어 PM 이 카드에서 고른다(미정 포함).
   * `raw` 는 답장에 적힌 이름이다. 그 밖의 카드는 null 이다
   */
  assigneePick: { raw: string | null } | null
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
