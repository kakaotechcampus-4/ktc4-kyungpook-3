export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'
/** 서버 NotionSyncStatus. 미연동이면 Task 의 값이 null 이다. `synced` 만 반영 완료다 */
export type NotionSyncStatus = 'pending' | 'synced' | 'failed'
export interface Task {
  id: string
  workspaceId: string
  meetingId: string | null
  title: string
  assigneeMemberId: string | null
  status: TaskStatus
  progress: number | null
  blocker: string | null
  dueDate: string | null
  startDate: string
  notionPageId: string | null
  /** 서버가 정한 정수 버전. task_update 충돌을 다시 승인할 때 이 값을 confirm_task_version 으로 보낸다 */
  version: number
  /** 페이지 ID 가 있어도 `synced` 가 아니면 반영 완료가 아니다. 모르는 값은 null 로 둔다 */
  notionSyncStatus: NotionSyncStatus | null
  createdAt: string
  updatedAt: string
}
export type TaskTab = 'all' | 'needs_review' | 'in_progress' | 'done'
export interface TaskHistoryEntry {
  id: string
  taskId: string
  // start_date 는 PR #59 가 ChangedField 에 추가했다 (계약 §2.6)
  field: 'assignee' | 'start_date' | 'due_date' | 'status' | 'title' | 'progress' | 'blocker'
  oldValue: string | null
  newValue: string | null
  source: 'meeting' | 'chat' | 'checkin' | 'notion' | 'reminder_reply' | 'manual'
  changedBy: string | null
  isAuto: boolean
  isRolledBack: boolean
  rolledBackAt: string | null
  createdAt: string
}
