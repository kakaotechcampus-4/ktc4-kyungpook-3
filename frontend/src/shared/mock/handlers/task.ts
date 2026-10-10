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
  enqueueTaskSync,
  notionConnected,
} from '../task-state'
import { MOCK_NOW } from '../fixtures/constants'
import { requireAuth, requireMember, requirePm } from '../auth-guard'
import type { TaskDto } from '@/shared/types/api/task'

/*
 * 백엔드 api/tasks.py 와 같은 권한 순서다. 인증(401) → 태스크 존재(404) → 그 공간 소속(403) → 쓰기면 PM(403).
 * 쓰기의 변경자는 본문·쿼리의 changed_by 가 아니라 세션 팀원이다 (auth-guard requirePm).
 * 권한 검사는 db 를 바꾸는 어떤 코드보다도 앞에 있다
 */

function findTask(taskId: unknown): TaskDto | undefined {
  return db.tasks.find(({ task_id }) => task_id === taskId)
}

export const taskHandlers = [
  http.get('/api/v1/tasks', ({ request }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
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
    const denied = requireMember(workspace)
    if (denied) return denied
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
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const task = findTask(params.taskId)
    if (!task) return fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404)
    return requireMember(task.workspace_id) ?? ok(task)
  }),
  http.patch('/api/v1/tasks/:taskId', async ({ params, request }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const task = findTask(params.taskId)
    if (!task) return fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404)
    const pm = requirePm(task.workspace_id)
    if (pm instanceof Response) return pm
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
    // 본문의 changed_by 는 taskUpdates 가 읽지 않는다. 백엔드처럼 세션 팀원으로 기록한다
    updateTask(task, updates, pm.memberId)
    return ok(task)
  }),
  http.get('/api/v1/tasks/:taskId/history', ({ params }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const task = findTask(params.taskId)
    if (!task) return fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404)
    const denied = requireMember(task.workspace_id)
    if (denied) return denied
    return list(
      db.taskHistory
        .filter(({ task_id }) => task_id === params.taskId)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    )
  }),
  http.post('/api/v1/tasks/:taskId/history/:historyId/rollback', ({ params }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const task = findTask(params.taskId)
    if (!task) return fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404)
    const pm = requirePm(task.workspace_id)
    if (pm instanceof Response) return pm
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
    // 쿼리의 changed_by 는 하위 호환용으로만 남은 값이다. 백엔드처럼 세션 팀원으로 기록한다
    addHistory(
      task.task_id,
      entry.changed_field,
      entry.new_value,
      entry.old_value,
      pm.memberId,
      entry.change_source,
    )
    // 백엔드 rollback_task_history 는 성공하면 항상 version 을 올리고 대기열에 넣는다
    task.version += 1
    enqueueTaskSync(task)
    return ok(task)
  }),
  /*
   * 백엔드 notion_sync.retry_failed_sync 의 단순화. 본문이 없다. 미연동이면 409, 실패 상태가 아니면 400 이고
   * 둘 다 아무것도 바꾸지 않는다. MSW 에는 잡 테이블·notion_synced_version 이 없어 태스크의
   * notion_sync_status 가 failed 인지로만 판정하고 pending 으로 되돌린다. 사용자 변경이 아니라 updated_at 은 그대로다
   */
  http.post('/api/v1/tasks/:taskId/notion-sync/retry', ({ params }) => {
    const unauthenticated = requireAuth()
    if (unauthenticated) return unauthenticated
    const task = findTask(params.taskId)
    if (!task) return fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404)
    const pm = requirePm(task.workspace_id)
    if (pm instanceof Response) return pm
    if (!notionConnected(task.workspace_id))
      return fail('INTEGRATION_NOT_CONNECTED', '연동이 필요합니다.', 409, { provider: 'notion' })
    if (task.notion_sync_status !== 'failed')
      return fail('INVALID_REQUEST', '재시도할 Notion 반영 실패 건이 없습니다.', 400, {
        task_id: task.task_id,
      })
    task.notion_sync_status = 'pending'
    return ok(task)
  }),
]
