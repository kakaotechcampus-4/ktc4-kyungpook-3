import { http } from 'msw'
import { db } from '../db'
import { ok, list, fail } from '../envelope'
import { MOCK_NOW } from '../fixtures/constants'
import { readJson } from '../utils'
import {
  createTask,
  updateTask,
  taskUpdates,
  validTaskFields,
  approvalTaskUpdateFields,
} from '../task-state'

export const approvalHandlers = [
  http.get('/api/v1/approvals', ({ request }) => {
    const query = new URL(request.url).searchParams
    const workspaceId = query.get('workspace_id')
    const status = query.get('status')
    if (!workspaceId || (status !== null && !['pending', 'approved', 'rejected'].includes(status)))
      return fail('INVALID_REQUEST', '승인 조회 조건이 올바르지 않습니다.', 400)
    return list(
      db.approvals
        .filter(
          (approval) =>
            approval.workspace_id === workspaceId &&
            (status === null || approval.status === status),
        )
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    )
  }),
  http.get('/api/v1/approvals/:approvalId', ({ params }) => {
    const approval = db.approvals.find(({ approval_id }) => approval_id === params.approvalId)
    return approval ? ok(approval) : fail('APPROVAL_NOT_FOUND', '승인 요청이 없습니다.', 404)
  }),
  http.patch('/api/v1/approvals/:approvalId', async ({ params, request }) => {
    const body = await readJson(request)
    if (
      !body ||
      (body.status !== 'approved' && body.status !== 'rejected') ||
      typeof body.resolved_by !== 'string'
    )
      return fail('INVALID_REQUEST', '처리 상태와 처리자가 필요합니다.', 400)
    const approval = db.approvals.find(({ approval_id }) => approval_id === params.approvalId)
    if (!approval) return fail('APPROVAL_NOT_FOUND', '승인 요청이 없습니다.', 404)
    if (approval.status !== 'pending')
      return fail('APPROVAL_ALREADY_RESOLVED', '이미 처리한 승인입니다.', 409)
    if (body.status === 'approved') {
      const payload = approval.payload
      if (approval.type === 'task_create') {
        const meetingId = typeof payload.meeting_id === 'string' ? payload.meeting_id : null
        const task = createTask(
          {
            workspace_id: approval.workspace_id,
            title:
              typeof payload.task_title === 'string' && payload.task_title
                ? payload.task_title
                : typeof payload.title === 'string'
                  ? payload.title
                  : '',
            meeting_id: meetingId,
            assignee_member_id:
              typeof payload.assignee_member_id === 'string' ? payload.assignee_member_id : null,
            due_date: typeof payload.due_date === 'string' ? payload.due_date : null,
          },
          body.resolved_by,
          meetingId ? 'meeting' : 'manual',
        )
        approval.related_task_id = task.task_id
      } else if (approval.type === 'task_update') {
        if (approval.related_task_id === null)
          return fail('INVALID_REQUEST', '변경할 태스크가 필요합니다.', 400)
        const task = db.tasks.find(({ task_id }) => task_id === approval.related_task_id)
        if (!task) return fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404)
        const changes: Record<string, unknown> = {}
        // start_date 는 승인 경로가 받지 않는다 (백엔드 _TASK_UPDATE_FIELDS 와 같다)
        for (const field of approvalTaskUpdateFields)
          if (field in payload) changes[field] = payload[field]
        if (!validTaskFields(changes))
          return fail('INVALID_REQUEST', '태스크 변경 값이 올바르지 않습니다.', 400)
        updateTask(task, taskUpdates(changes), body.resolved_by, 'meeting')
      }
    }
    approval.status = body.status
    approval.resolved_by = body.resolved_by
    approval.resolved_at = MOCK_NOW
    return ok(approval)
  }),
]
