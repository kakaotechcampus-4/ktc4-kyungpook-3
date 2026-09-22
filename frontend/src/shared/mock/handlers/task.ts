import { http } from 'msw'
import { db } from '../db'
import { ok, list, fail } from '../envelope'
import { readJson } from '../utils'
import {
  createTask,
  updateTask,
  taskFields,
  taskUpdates,
  validTaskFields,
  validDate,
  addHistory,
  ownershipError,
} from '../task-state'
import { MOCK_NOW } from '../fixtures/constants'

export const taskHandlers = [
  http.get('/api/v1/tasks', ({ request }) => {
    const query = new URL(request.url).searchParams
    const workspace = query.get('workspace_id')
    const status = query.get('status')
    const assignee = query.get('assignee_member_id')
    const before = query.get('due_before')
    const after = query.get('due_after')
    if (
      !workspace ||
      (status !== null && !['todo', 'in_progress', 'blocked', 'done'].includes(status)) ||
      (before !== null && !validDate(before)) ||
      (after !== null && !validDate(after))
    )
      return fail('INVALID_REQUEST', '태스크 조회 조건이 올바르지 않습니다.', 400)
    const tasks = db.tasks.filter(
      (task) =>
        task.workspace_id === workspace &&
        (status === null || task.status === status) &&
        (assignee === null || task.assignee_member_id === assignee) &&
        (before === null || (task.due_date !== null && task.due_date <= before)) &&
        (after === null || (task.due_date !== null && task.due_date >= after)),
    )
    tasks.sort(
      (a, b) =>
        (a.due_date ?? '').localeCompare(b.due_date ?? '') ||
        Date.parse(b.created_at) - Date.parse(a.created_at),
    )
    return list(tasks)
  }),
  http.post('/api/v1/tasks', async ({ request }) => {
    const body = await readJson(request)
    if (
      !body ||
      typeof body.workspace_id !== 'string' ||
      typeof body.title !== 'string' ||
      !validTaskFields(body)
    )
      return fail('INVALID_REQUEST', '태스크 요청이 올바르지 않습니다.', 400)
    if (!db.workspaces.some(({ workspace_id }) => workspace_id === body.workspace_id))
      return fail('WORKSPACE_NOT_FOUND', '워크스페이스가 없습니다.', 404)
    const owned = ownershipError(body.workspace_id, body)
    if (owned)
      return fail(owned.code, owned.message, owned.code === 'WORKSPACE_MISMATCH' ? 400 : 404)
    return ok(
      createTask(
        {
          ...taskUpdates(body),
          workspace_id: body.workspace_id,
          title: body.title,
          meeting_id: typeof body.meeting_id === 'string' ? body.meeting_id : null,
        },
        typeof body.created_by === 'string' ? body.created_by : null,
      ),
      { status: 201 },
    )
  }),
  http.get('/api/v1/tasks/:taskId', ({ params }) => {
    const task = db.tasks.find(({ task_id }) => task_id === params.taskId)
    return task ? ok(task) : fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404)
  }),
  http.patch('/api/v1/tasks/:taskId', async ({ params, request }) => {
    const task = db.tasks.find(({ task_id }) => task_id === params.taskId)
    if (!task) return fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404)
    const body = await readJson(request)
    if (!body || !validTaskFields(body))
      return fail('INVALID_REQUEST', '태스크 변경 값이 올바르지 않습니다.', 400)
    const updates = taskUpdates(body)
    if (Object.keys(updates).length === 0)
      return fail('INVALID_REQUEST', '변경할 값이 없습니다.', 400)
    // 백엔드 apply_task_updates 는 PATCH 에서 담당자만 검증한다
    const owned = ownershipError(task.workspace_id, {
      assignee_member_id: updates.assignee_member_id,
    })
    if (owned)
      return fail(owned.code, owned.message, owned.code === 'WORKSPACE_MISMATCH' ? 400 : 404)
    updateTask(task, updates, typeof body.changed_by === 'string' ? body.changed_by : null)
    return ok(task)
  }),
  http.get('/api/v1/tasks/:taskId/history', ({ params }) => {
    if (!db.tasks.some(({ task_id }) => task_id === params.taskId))
      return fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404)
    return list(
      db.taskHistory
        .filter(({ task_id }) => task_id === params.taskId)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    )
  }),
  http.post('/api/v1/tasks/:taskId/history/:historyId/rollback', ({ params, request }) => {
    const task = db.tasks.find(({ task_id }) => task_id === params.taskId)
    if (!task) return fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404)
    const entry = db.taskHistory.find(
      (history) => history.history_id === params.historyId && history.task_id === task.task_id,
    )
    if (!entry) return fail('TASK_HISTORY_NOT_FOUND', '태스크 이력이 없습니다.', 404)
    if (entry.is_rolled_back)
      return fail('TASK_HISTORY_ALREADY_ROLLED_BACK', '이미 되돌린 이력입니다.', 409)
    const field = entry.changed_field === 'assignee' ? 'assignee_member_id' : entry.changed_field
    if (!(taskFields as readonly string[]).includes(field))
      return fail('INVALID_REQUEST', '되돌릴 수 없는 변경 항목입니다.', 400)
    // 최초 생성 이력은 NOT NULL 필드에 null 을 넣게 되므로 거절한다 (백엔드와 같은 400)
    if ((field === 'title' || field === 'status') && entry.old_value === null)
      return fail('INVALID_REQUEST', '최초 생성 이력은 되돌릴 수 없습니다.', 400)
    // 충돌 감지 — 이 이력이 남긴 값이 지금 값과 다르면 이후 다른 변경이 있었다 (PR #55)
    const current = task[field as keyof typeof task]
    if ((current === null ? null : String(current)) !== entry.new_value)
      return fail(
        'INVALID_REQUEST',
        '이후 다른 변경이 있어 되돌릴 수 없습니다. 최신 이력부터 되돌려주세요.',
        400,
      )
    Object.assign(task, {
      [field]:
        field === 'progress' && entry.old_value !== null
          ? Number(entry.old_value)
          : entry.old_value,
    })
    entry.is_rolled_back = true
    entry.rolled_back_at = MOCK_NOW
    task.updated_at = MOCK_NOW
    addHistory(
      task.task_id,
      entry.changed_field,
      entry.new_value,
      entry.old_value,
      new URL(request.url).searchParams.get('changed_by'),
      entry.change_source,
    )
    return ok(task)
  }),
]
