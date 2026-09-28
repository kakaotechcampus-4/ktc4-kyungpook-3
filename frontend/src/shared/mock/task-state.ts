import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'
import { db } from './db'
import { MOCK_NOW } from './fixtures/constants'
import { nextId } from './utils'

// 백엔드 services/tasks.py 의 _FIELD_MAP 과 같은 집합이다. 이 목록에 있으면 이력이 남는다.
export const taskFields = [
  'title',
  'assignee_member_id',
  'status',
  'progress',
  'blocker',
  'start_date',
  'due_date',
] as const
export type TaskField = (typeof taskFields)[number]
export type TaskUpdates = Partial<Pick<TaskDto, TaskField>>
// PATCH 로 null 을 보내 지울 수 있는 필드는 title·status 를 뺀 나머지다.
// 그 둘은 NOT NULL 이라 validTaskFields 가 400 으로 거른다.

// 승인(task_update) 반영이 받는 필드는 더 좁다. 백엔드 approvals.py 의 _TASK_UPDATE_FIELDS 와 같고
// start_date 가 빠져 있다. 승인 payload 에 start_date 가 있어도 무시된다.
export const approvalTaskUpdateFields: readonly TaskField[] = [
  'title',
  'assignee_member_id',
  'status',
  'progress',
  'blocker',
  'due_date',
]
export function createTask(
  input: Pick<TaskDto, 'workspace_id' | 'title'> & Partial<TaskDto>,
  actor: string | null,
  source = 'manual',
): TaskDto {
  const task: TaskDto = {
    task_id: nextId(
      'tk',
      db.tasks.map(({ task_id }) => task_id),
      90,
    ),
    workspace_id: input.workspace_id,
    meeting_id: input.meeting_id ?? null,
    title: input.title,
    assignee_member_id: input.assignee_member_id ?? null,
    status: input.status ?? 'todo',
    progress: input.progress ?? null,
    blocker: input.blocker ?? null,
    due_date: input.due_date ?? null,
    start_date: input.start_date ?? null,
    notion_page_id: null,
    created_at: MOCK_NOW,
    updated_at: MOCK_NOW,
  }
  db.tasks.push(task)
  addHistory(task.task_id, 'title', null, task.title, actor, source)
  return task
}
export function addHistory(
  taskId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  actor: string | null,
  source: string,
): TaskHistoryDto {
  const entry: TaskHistoryDto = {
    history_id: nextId(
      'hs',
      db.taskHistory.map(({ history_id }) => history_id),
      90,
    ),
    task_id: taskId,
    changed_field: field,
    old_value: oldValue,
    new_value: newValue,
    change_source: source,
    changed_by: actor,
    is_auto: false,
    is_rolled_back: false,
    rolled_back_at: null,
    created_at: MOCK_NOW,
  }
  db.taskHistory.push(entry)
  return entry
}
export function updateTask(
  task: TaskDto,
  updates: TaskUpdates,
  actor: string | null,
  source = 'manual',
): void {
  for (const field of taskFields) {
    if (!(field in updates) || task[field] === updates[field]) continue
    const value = updates[field]
    if (value === undefined) continue
    const old = task[field]
    addHistory(
      task.task_id,
      field === 'assignee_member_id' ? 'assignee' : field,
      old === null ? null : String(old),
      value === null ? null : String(value),
      actor,
      source,
    )
    Object.assign(task, { [field]: value })
  }
  task.updated_at = MOCK_NOW
}
export function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
// title·status 는 명시적 null 을 거절한다. 백엔드 validate_task_fields 가 400 을 내는 것과 같다.
export function validTaskFields(body: Record<string, unknown>): boolean {
  return (
    (body.title === undefined ||
      (typeof body.title === 'string' &&
        body.title.trim().length > 0 &&
        body.title.length <= 300)) &&
    (body.status === undefined ||
      (typeof body.status === 'string' &&
        ['todo', 'in_progress', 'blocked', 'done'].includes(body.status))) &&
    (body.progress === undefined ||
      body.progress === null ||
      (typeof body.progress === 'number' &&
        Number.isInteger(body.progress) &&
        body.progress >= 0 &&
        body.progress <= 100)) &&
    ['assignee_member_id', 'blocker'].every(
      (field) =>
        body[field] === undefined || body[field] === null || typeof body[field] === 'string',
    ) &&
    ['due_date', 'start_date'].every(
      (field) => body[field] === undefined || body[field] === null || validDate(body[field]),
    )
  )
}
// 본문에 있는 키만 모은다. null 도 값이다 — 백엔드가 exclude_unset 만 쓰고
// exclude_none 을 쓰지 않으므로(PR #55), 명시적 null 은 필드 해제로 적용된다.
// 백엔드 services/tasks.py 의 validate_workspace_ownership 과 같다.
// Task 에 연결하는 ID 가 같은 워크스페이스 소속인지 본다. null 이면 검사하지 않는다.
export function ownershipError(
  workspaceId: string,
  ids: { assignee_member_id?: unknown; meeting_id?: unknown },
): {
  code: 'MEMBER_NOT_FOUND' | 'MEETING_NOT_FOUND' | 'WORKSPACE_MISMATCH'
  message: string
} | null {
  if (typeof ids.assignee_member_id === 'string') {
    const member = db.members.find(({ member_id }) => member_id === ids.assignee_member_id)
    if (!member) return { code: 'MEMBER_NOT_FOUND', message: '팀원이 없습니다.' }
    if (member.workspace_id !== workspaceId)
      return { code: 'WORKSPACE_MISMATCH', message: '담당자가 해당 워크스페이스 소속이 아닙니다.' }
  }
  if (typeof ids.meeting_id === 'string') {
    const meeting = db.meetings.find(({ meeting_id }) => meeting_id === ids.meeting_id)
    if (!meeting) return { code: 'MEETING_NOT_FOUND', message: '회의가 없습니다.' }
    if (meeting.workspace_id !== workspaceId)
      return { code: 'WORKSPACE_MISMATCH', message: '회의가 해당 워크스페이스 소속이 아닙니다.' }
  }
  return null
}
export function taskUpdates(body: Record<string, unknown>): TaskUpdates {
  const updates: Record<string, unknown> = {}
  for (const field of taskFields) {
    if (body[field] !== undefined) updates[field] = body[field]
  }
  return updates
}
