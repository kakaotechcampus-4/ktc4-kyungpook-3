export interface TaskDto {
  task_id: string
  workspace_id: string
  meeting_id: string | null
  title: string
  assignee_member_id: string | null
  status: string
  progress: number | null
  blocker: string | null
  due_date: string | null
  start_date?: string | null
  notion_page_id: string | null
  created_at: string
  updated_at: string
}
export interface TaskHistoryDto {
  history_id: string
  task_id: string
  changed_field: string
  old_value: string | null
  new_value: string | null
  change_source: string
  changed_by: string | null
  is_auto: boolean
  is_rolled_back: boolean
  rolled_back_at: string | null
  created_at: string
}
