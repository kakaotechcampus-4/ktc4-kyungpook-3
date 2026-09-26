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
