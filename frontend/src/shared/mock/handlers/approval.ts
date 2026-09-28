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
  ownershipError,
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
        // 백엔드 _get_linkable_extraction_item 처럼 Task 를 만들기 전에 연결 대상부터 검증한다.
        // MSW 에는 롤백이 없으므로 이 검사는 db 를 바꾸는 어떤 코드보다도 앞에 있어야 한다.
        // 항목이 없으면 연결 없이 진행한다
        const extractionItemId =
          typeof payload.extraction_item_id === 'string' ? payload.extraction_item_id : ''
        const extraction = extractionItemId
          ? db.extractions.find(({ items }) =>
              items.some(({ item_id }) => item_id === extractionItemId),
            )
          : undefined
        const linkedItem = extraction?.items.find(({ item_id }) => item_id === extractionItemId)
        if (extraction && linkedItem) {
          const itemWorkspaceId = db.meetings.find(
            ({ meeting_id }) => meeting_id === extraction.meeting_id,
          )?.workspace_id
          if (itemWorkspaceId !== approval.workspace_id)
            return fail(
              'WORKSPACE_MISMATCH',
              '승인 요청의 워크스페이스와 추출 항목의 워크스페이스가 다릅니다.',
              400,
              {
                extraction_item_id: extractionItemId,
                approval_workspace_id: approval.workspace_id,
                extraction_item_workspace_id: itemWorkspaceId ?? null,
              },
            )
          if (linkedItem.approval_id !== approval.approval_id)
            return fail(
              'INVALID_REQUEST',
              '추출 항목이 이 승인 요청에 연결되어 있지 않습니다.',
              400,
              {
                extraction_item_id: extractionItemId,
                approval_id: approval.approval_id,
                extraction_item_approval_id: linkedItem.approval_id,
              },
            )
        }
        const meetingId = typeof payload.meeting_id === 'string' ? payload.meeting_id : null
        const title =
          typeof payload.task_title === 'string' && payload.task_title
            ? payload.task_title
            : typeof payload.title === 'string'
              ? payload.title
              : ''
        // 백엔드 _apply_approval 은 status·progress 도 읽고 validate_task_fields 를 거친다
        const created: Record<string, unknown> = { title }
        if (payload.status !== undefined && payload.status !== null) created.status = payload.status
        if (payload.progress !== undefined && payload.progress !== null)
          created.progress = payload.progress
        if (!validTaskFields(created))
          return fail('INVALID_REQUEST', '승인 내용이 올바르지 않습니다.', 400)
        const owned = ownershipError(approval.workspace_id, payload)
        if (owned)
          return fail(owned.code, owned.message, owned.code === 'WORKSPACE_MISMATCH' ? 400 : 404)
        const task = createTask(
          {
            workspace_id: approval.workspace_id,
            title,
            status: typeof created.status === 'string' ? created.status : undefined,
            progress: typeof created.progress === 'number' ? created.progress : null,
            meeting_id: meetingId,
            assignee_member_id:
              typeof payload.assignee_member_id === 'string' ? payload.assignee_member_id : null,
            due_date: typeof payload.due_date === 'string' ? payload.due_date : null,
          },
          body.resolved_by,
          meetingId ? 'meeting' : 'manual',
        )
        approval.related_task_id = task.task_id
        // 실 백엔드와 같게 — 위에서 검증한 그 항목의 task_id 만 채우되 approval_id 는 비우지 않는다
        // (계약 §3.1, §4.0-②-12). 화면은 task_id 를 우선으로 읽어 이 상태를 반영됨으로 다룬다.
        if (linkedItem) linkedItem.task_id = task.task_id
      } else if (approval.type === 'task_update') {
        if (approval.related_task_id === null)
          return fail('INVALID_REQUEST', '변경할 태스크가 필요합니다.', 400)
        const task = db.tasks.find(({ task_id }) => task_id === approval.related_task_id)
        if (!task) return fail('TASK_NOT_FOUND', '태스크가 없습니다.', 404)
        // 백엔드는 승인과 대상 태스크의 워크스페이스가 다르면 400 WORKSPACE_MISMATCH 다
        if (task.workspace_id !== approval.workspace_id)
          return fail(
            'WORKSPACE_MISMATCH',
            '승인 요청의 워크스페이스와 대상 태스크의 워크스페이스가 다릅니다.',
            400,
          )
        const changes: Record<string, unknown> = {}
        // start_date 는 승인 경로가 받지 않는다 (백엔드 _TASK_UPDATE_FIELDS 와 같다)
        for (const field of approvalTaskUpdateFields)
          if (field in payload) changes[field] = payload[field]
        if (!validTaskFields(changes))
          return fail('INVALID_REQUEST', '태스크 변경 값이 올바르지 않습니다.', 400)
        // 백엔드 apply_task_updates 는 값 검증 뒤 담당자 소속을 본다. 기준은 task.workspace_id 다
        const assigned = ownershipError(task.workspace_id, {
          assignee_member_id: changes.assignee_member_id,
        })
        if (assigned)
          return fail(
            assigned.code,
            assigned.message,
            assigned.code === 'WORKSPACE_MISMATCH' ? 400 : 404,
          )
        updateTask(task, taskUpdates(changes), body.resolved_by, 'meeting')
      }
    }
    approval.status = body.status
    approval.resolved_by = body.resolved_by
    approval.resolved_at = MOCK_NOW
    return ok(approval)
  }),
]
