import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'
import { db } from './db'
import type { MockDb } from './db'
import { MOCK_NOW } from './fixtures/constants'
import type { MockTask } from './fixtures/task'
import { nextId } from './utils'

// 백엔드 services/tasks.py 의 _FIELD_MAP 과 같은 집합이다. 이 목록에 있으면 이력이 남는다.
export const taskFields = [
  'title',
  'assignee_member_id',
  'status',
  'blocker',
  'start_date',
  'due_date',
] as const
export type TaskField = (typeof taskFields)[number]
export type TaskUpdates = Partial<Pick<MockTask, TaskField>>
// PATCH 로 null 을 보내 지울 수 있는 필드는 title·status 를 뺀 나머지다.
// 그 둘은 NOT NULL 이라 validTaskFields 가 400 으로 거른다.

// 승인(task_update) 반영이 받는 필드는 더 좁다. 백엔드 approvals.py 의 _TASK_UPDATE_FIELDS 와 같고
// start_date 가 빠져 있다. 승인 payload 에 start_date 가 있어도 무시된다.
export const approvalTaskUpdateFields: readonly TaskField[] = [
  'title',
  'assignee_member_id',
  'status',
  'blocker',
  'due_date',
]
/** `state` 를 주면 그 상태에 쓴다 — 시나리오가 `db` 에 넣기 전의 상태를 만들 때다. 기본은 `db` */
export function createTask(
  input: Pick<MockTask, 'workspace_id' | 'title'> & Partial<MockTask> & { history_title?: string },
  actor: string | null,
  source = 'manual',
  state: MockDb = db,
): MockTask {
  const task: MockTask = {
    task_id: nextId(
      'tk',
      state.tasks.map(({ task_id }) => task_id),
      90,
    ),
    workspace_id: input.workspace_id,
    meeting_id: input.meeting_id ?? null,
    title: input.title,
    assignee_member_id: input.assignee_member_id ?? null,
    status: input.status ?? 'todo',
    blocker: input.blocker ?? null,
    due_date: input.due_date ?? null,
    start_date: input.start_date ?? null,
    notion_page_id: null,
    version: 1,
    notion_sync_status: null,
    created_at: MOCK_NOW,
    updated_at: MOCK_NOW,
  }
  state.tasks.push(task)
  addHistory(task.task_id, 'title', null, input.history_title ?? task.title, actor, source, state)
  enqueueTaskSync(task, state)
  return task
}

/**
 * 그 공간이 Notion 에 연동됐는가. 백엔드 notion.is_configured 는 토큰과 대상 데이터베이스 ID 를 보지만
 * MSW 에는 둘 다 없다 — 연동 상태가 `connected` 일 때만 연동된 것으로 본다. not_connected·revoked·없음은 미연동이다
 */
export function notionConnected(workspaceId: string, state: MockDb = db): boolean {
  return state.integrations[workspaceId]?.notion.status === 'connected'
}

/**
 * 백엔드 notion_sync.enqueue_task_sync 에 대응한다. 연동된 공간이면 반영 대기(`pending`)로 둔다.
 * 미연동이면 아무것도 하지 않는다 — 기존 값도 그대로다. 잡 테이블·워커는 흉내내지 않는다:
 * `synced`·`failed` 는 테스트와 시나리오가 태스크 필드를 직접 넣어 만든다
 */
export function enqueueTaskSync(task: MockTask, state: MockDb = db): void {
  if (notionConnected(task.workspace_id, state)) task.notion_sync_status = 'pending'
}
export function addHistory(
  taskId: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  actor: string | null,
  source: string,
  state: MockDb = db,
): TaskHistoryDto {
  const entry: TaskHistoryDto = {
    history_id: nextId(
      'hs',
      state.taskHistory.map(({ history_id }) => history_id),
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
  state.taskHistory.push(entry)
  return entry
}
/**
 * 백엔드 apply_task_updates 와 같다. 실제로 바뀐 필드마다 이력을 남기고, 하나라도 바뀌었을 때만
 * version 을 1 올리고 Notion 반영을 대기열에 넣는다. 모두 같은 값이면 아무것도 바꾸지 않는다. 바뀐 필드 수를 돌려준다
 */
export function updateTask(
  task: MockTask,
  updates: TaskUpdates,
  actor: string | null,
  source = 'manual',
): number {
  let changed = 0
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
    changed += 1
  }
  if (changed > 0) {
    task.updated_at = MOCK_NOW
    task.version += 1
    enqueueTaskSync(task)
  }
  return changed
}

export function taskCreateFields(input: {
  title: unknown
  assignee_member_id: unknown
  due_date: unknown
}):
  | { ok: true; title: string; assignee_member_id: string | null; due_date: string | null }
  | { ok: false; field: 'task_title' | 'assignee_member_id' | 'due_date' } {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const length = [...title].length
  if (length < 1 || length > 300) return { ok: false, field: 'task_title' }
  if (input.assignee_member_id != null && typeof input.assignee_member_id !== 'string')
    return { ok: false, field: 'assignee_member_id' }
  if (input.due_date != null && !validDate(input.due_date)) return { ok: false, field: 'due_date' }
  return {
    ok: true,
    title,
    assignee_member_id:
      typeof input.assignee_member_id === 'string' ? input.assignee_member_id : null,
    due_date: typeof input.due_date === 'string' ? input.due_date : null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface TaskConflict {
  field: string
  base: unknown
  current: unknown
  proposed: unknown
}

/**
 * 백엔드 approvals.py 의 _find_conflicts 와 같다. 지금 값이 제안할 때 비교한 값(base_values)과 다르고
 * 제안 값과도 다르면 충돌이다. base_values 가 객체가 아니거나 그 필드가 없으면 그 필드는 보지 않는다.
 * 값은 payload 에 저장된 모양(날짜는 ISO 문자열)이라 태스크 값과 그대로 비교한다
 */
export function findConflicts(
  task: MockTask,
  proposed: Record<string, unknown>,
  baseValues: unknown,
): TaskConflict[] {
  if (!isRecord(baseValues)) return []
  const conflicts: TaskConflict[] = []
  for (const [field, proposedValue] of Object.entries(proposed)) {
    if (!Object.hasOwn(baseValues, field)) continue
    const current = task[field as keyof MockTask]
    if (current !== baseValues[field] && current !== proposedValue)
      conflicts.push({ field, base: baseValues[field], current, proposed: proposedValue })
  }
  return conflicts
}
// 백엔드 parse_date 의 date.fromisoformat 은 1~9999년만 받는다. JS Date 는 0000년도 받으므로
// 연도는 문자열 앞 네 자리로 따로 본다
export function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number(value.slice(0, 4)) >= 1 &&
    Number(value.slice(0, 4)) <= 9999 &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  )
}
// title·status 는 명시적 null 을 거절한다. 백엔드 validate_task_fields 가 400 을 내는 것과 같다.
export function validTaskFields(body: Record<string, unknown>): boolean {
  return (
    (body.title === undefined ||
      (typeof body.title === 'string' &&
        [...body.title.trim()].length > 0 &&
        [...body.title.trim()].length <= 300)) &&
    (body.status === undefined ||
      (typeof body.status === 'string' &&
        ['todo', 'in_progress', 'blocked', 'done'].includes(body.status))) &&
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

/** 스케줄러가 72시간 무응답으로 건 막힘의 사유 (계약 §5.7 「스케줄러」) */
export const SILENCE_BLOCKER = '리마인드에 72시간 동안 응답이 없어요'

/** 백엔드 scheduler `_block` 과 같다. 이력 출처는 scheduler 다 */
export function blockBySilence(task: MockTask, at: string, state: MockDb = db): void {
  if (task.status === 'blocked') return
  state.autoBlocks[task.task_id] = { prev_status: task.status, prev_blocker: task.blocker }
  const changes = [
    ['status', 'blocked'],
    ['blocker', SILENCE_BLOCKER],
  ] as const
  for (const [field, value] of changes) {
    const entry = addHistory(task.task_id, field, task[field], value, null, 'scheduler', state)
    entry.is_auto = true
    entry.created_at = at
  }
  task.status = 'blocked'
  task.blocker = SILENCE_BLOCKER
  task.updated_at = at
  task.version += 1
}

/** 백엔드 `_auto_block_state`·`_undoable_watches` 와 같다. 풀기와 응답 조립이 이 판정 하나를 같이 쓴다 */
export function canUndoAutoBlock(task: MockTask, state: MockDb = db): boolean {
  return (
    Object.hasOwn(state.autoBlocks, task.task_id) &&
    task.status === 'blocked' &&
    task.blocker === SILENCE_BLOCKER
  )
}

export function toTaskResponse(task: MockTask, state: MockDb = db): TaskDto {
  return {
    ...task,
    auto_blocked: canUndoAutoBlock(task, state),
    meeting_deleted: state.meetingDeletions.some(
      ({ meeting_id }) => meeting_id === task.meeting_id,
    ),
  }
}

/** 백엔드 `undo_auto_block` 과 같다. false 면 409 `AUTO_BLOCK_NOT_FOUND` 다 */
export function undoAutoBlock(task: MockTask, actor: string): boolean {
  if (!canUndoAutoBlock(task)) return false
  const { prev_status, prev_blocker } = db.autoBlocks[task.task_id]
  updateTask(task, { status: prev_status, blocker: prev_blocker }, actor)
  delete db.autoBlocks[task.task_id]
  return true
}
