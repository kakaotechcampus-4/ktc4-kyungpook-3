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
