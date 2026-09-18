import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'
import { db } from './db'
import { MOCK_NOW } from './fixtures/constants'
import { nextId } from './utils'

export const taskFields = [
  'title',
  'assignee_member_id',
  'status',
  'progress',
  'blocker',
  'due_date',
] as const
export type TaskUpdates = Partial<Pick<TaskDto, (typeof taskFields)[number] | 'start_date'>>
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
  // start_date는 요청 중인 증분 필드다. 계약의 history enum에는 없으므로 새 이력 필드를 발명하지 않는다.
  if ('start_date' in updates) task.start_date = updates.start_date
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
export function validTaskFields(body: Record<string, unknown>): boolean {
  return (
    (body.title === undefined ||
      body.title === null ||
      (typeof body.title === 'string' && body.title.length > 0 && body.title.length <= 300)) &&
    (body.status === undefined ||
      body.status === null ||
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
export function taskUpdates(body: Record<string, unknown>, includeNull = false): TaskUpdates {
  const updates: Record<string, unknown> = {}
  for (const field of [...taskFields, 'start_date'] as const) {
    if (body[field] !== undefined && (includeNull || body[field] !== null))
      updates[field] = body[field]
  }
  return updates
}
