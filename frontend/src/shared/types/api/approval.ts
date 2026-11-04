export interface ApprovalDto {
  approval_id: string
  workspace_id: string
  type: string
  payload: Record<string, unknown>
  related_task_id: string | null
  requested_by: string | null
  status: string
  resolved_by: string | null
  created_at: string
  resolved_at: string | null
}

export type TaskOverridesDto =
  | Partial<{ task_title: string; assignee_member_id: string | null; due_date: string | null }>
  | Partial<{ status: 'todo' | 'in_progress' | 'blocked' | 'done'; due_date: string | null }>

export interface ApprovalResolveRequestDto {
  status: 'approved' | 'rejected'
  confirm_task_version?: number
  task_overrides?: TaskOverridesDto
}

export interface ApprovalConflictItemDto {
  field: string
  base: unknown
  current: unknown
  proposed: unknown
}

/** 409 APPROVAL_CONFLICT 의 `details` */
export interface ApprovalConflictDetailsDto {
  approval_id: string
  task_id: string
  task_version: number
  conflicts: ApprovalConflictItemDto[]
}

/** 409 APPROVAL_ALREADY_RESOLVED 의 `details` */
export interface ApprovalAlreadyResolvedDetailsDto {
  approval_id: string
  current_status: string
}
