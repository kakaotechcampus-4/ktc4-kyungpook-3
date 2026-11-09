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
  /**
   * 승인하며 고른 담당자의 별칭으로 등록할 수 있는 글자 (#523). 서버가 후보라고 하고 글자가 있을 때만 있다.
   * 후보 여부와 글자를 한 칸에 둬 「후보인데 글자가 없다」를 만들 수 없게 한다
   */
  aliasCandidate: string | null
  /** 카드 내용의 지문 (#547). 승인·반려에 PM 이 본 값을 실어 그 뒤에 바뀐 카드를 막는다. 없으면 보내지 않는다 */
  payloadVersion: string | null
  /** 이 카드에 합쳐진 다른 회의의 항목 (#533). 합쳐진 차례대로다. 카드를 만든 항목(대표 근거)은 들어 있지 않다 */
  mergedItems: MergedApprovalItem[]
  /** 담당자를 정한 항목. 합치며 담당자가 바뀌었으면 그 항목이고, 아니면 카드를 만든 항목이다 */
  assigneeItemId: string | null
}
export interface MergedApprovalItem {
  extractionItemId: string | null
  meetingId: string | null
  evidence: ExtractionEvidence
  docText: string | null
  mergedAt: string | null
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
   * 답장이 말한 담당자를 팀원에서 찾지 못한 카드. 제안에 담당자 값이 없어 PM 이 카드에서 고른다(미정 포함).
   * `raw` 는 답장에 적힌 이름이다. 그 밖의 카드는 null 이다
   */
  assigneePick: { raw: string } | null
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
 * - `changed`: PM 이 본 뒤 카드 내용이 바뀌었다 (409 APPROVAL_CHANGED). 새 카드를 받아 확인한 뒤 다시 처리한다
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
  | { kind: 'changed' }
