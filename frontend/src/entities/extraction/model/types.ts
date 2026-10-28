import type { ExtractionEvidence } from '@/shared/types/common'
export type { ExtractionEvidence } from '@/shared/types/common'
export type ExtractionGate = 'auto' | 'review' | 'hold'
export type ExtractionApprovalStatus = 'pending' | 'approved' | 'rejected'
export interface ExtractionItem {
  id: string
  title: string
  confidence: number
  gate: ExtractionGate
  assigneeMemberId: string | null
  assigneeLabel: string
  dueDate: string | null
  dueRaw: string | null
  evidence: ExtractionEvidence
  appliedTaskId: string | null
  approvalId: string | null
  /** 연결된 승인의 지금 상태. 승인이 없거나 모르는 값이면 null */
  approvalStatus: ExtractionApprovalStatus | null
  /** PM 이 auto 태스크를 되돌린 시각. 있으면 `gate` 가 auto 여도 태스크는 지워졌고 승인이 새로 걸렸다 */
  revertedAt: string | null
}
export interface Extraction {
  id: string
  meetingId: string
  items: ExtractionItem[]
}

/** 되돌리기 성공. 지운 태스크와 대신 만든 확인 필요(생성 승인) */
export interface AutoItemRevert {
  itemId: string
  revertedTaskId: string
  approvalId: string
  revertedAt: string
}

/** 409 AUTO_TASK_NOT_REVERTIBLE 의 사유 (backend extractions.revert_auto_item). 모르는 값은 `unknown` */
export type AutoItemRevertReason =
  | 'already_reverted'
  | 'not_auto_created'
  | 'task_missing'
  | 'task_changed'
  | 'pending_approval'
  | 'unknown'

/** 서버가 되돌리기를 거절했다. `task_changed` 면 `taskId`, `pending_approval` 이면 `approvalId` 가 함께 온다 */
export interface AutoItemRevertRejection {
  reason: AutoItemRevertReason
  taskId: string | null
  approvalId: string | null
}
