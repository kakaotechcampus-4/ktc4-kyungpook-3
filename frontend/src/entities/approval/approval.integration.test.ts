import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { ListDto } from '@/shared/types/api/envelope'
import type { ApprovalDto } from '@/shared/types/api/approval'
import type { TaskDto } from '@/shared/types/api/task'
import { db } from '@/shared/mock/db'
import { toApproval } from './model/mapper'

it('returns scoped approvals newest first and maps detail', async () => {
  const approvals = await fetchDto<ListDto<ApprovalDto>>(
    '/approvals?workspace_id=ws_01&status=pending',
  )
  expect(approvals.total).toBe(3)
  expect(approvals.items.map(toApproval).map(({ id }) => id)).toEqual(['ap_03', 'ap_02', 'ap_01'])
  expect(await fetchDto('/approvals?workspace_id=ws_02')).toEqual({ items: [], total: 0 })
  expect(toApproval(await fetchDto<ApprovalDto>('/approvals/ap_01'))).toMatchObject({
    kind: 'task_create',
    missing: ['assignee', 'due'],
  })
})

it('approval creates a task once, closes the request and records the resolver', async () => {
  const approval = toApproval(
    await fetchDto<ApprovalDto>(
      '/approvals/ap_01',
      jsonRequest('PATCH', { status: 'approved', resolved_by: 'mb_01' }),
    ),
  )
  expect(approval).toMatchObject({
    status: 'approved',
    relatedTaskId: 'tk_90',
    resolvedBy: 'mb_01',
    resolvedAt: '2026-09-18T09:00:00+09:00',
  })
  expect((await fetchDto<ListDto<TaskDto>>('/tasks?workspace_id=ws_01')).total).toBe(11)
  expect(await fetchDto<TaskDto>('/tasks/tk_90')).toMatchObject({
    title: '알림 문구 검토',
    meeting_id: 'mt_09',
    status: 'todo',
    assignee_member_id: null,
    due_date: null,
  })
  expect(
    (await fetchDto<ListDto<ApprovalDto>>('/approvals?workspace_id=ws_01&status=pending')).total,
  ).toBe(2)
  await expect(
    fetchDto(
      '/approvals/ap_01',
      jsonRequest('PATCH', { status: 'rejected', resolved_by: 'mb_01' }),
    ),
  ).rejects.toMatchObject({ code: 'APPROVAL_ALREADY_RESOLVED', status: 409 })
})

it('resets approval and task data between tests and rejects without creating a task', async () => {
  expect((await fetchDto<ListDto<TaskDto>>('/tasks?workspace_id=ws_01')).total).toBe(10)
  expect(
    (await fetchDto<ListDto<ApprovalDto>>('/approvals?workspace_id=ws_01&status=pending')).total,
  ).toBe(3)
  expect(
    toApproval(
      await fetchDto<ApprovalDto>(
        '/approvals/ap_01',
        jsonRequest('PATCH', { status: 'rejected', resolved_by: 'mb_01' }),
      ),
    ),
  ).toMatchObject({ status: 'rejected', relatedTaskId: null })
  expect((await fetchDto<ListDto<TaskDto>>('/tasks?workspace_id=ws_01')).total).toBe(10)
})

it('applies task-update payload instead of creating another task', async () => {
  db.approvals[0].type = 'task_update'
  db.approvals[0].related_task_id = 'tk_01'
  db.approvals[0].payload = {
    status: 'done',
    progress: 100,
    due_date: null,
    start_date: '2020-01-01',
  }
  await fetchDto(
    '/approvals/ap_01',
    jsonRequest('PATCH', { status: 'approved', resolved_by: 'mb_01' }),
  )
  expect(await fetchDto('/tasks/tk_01')).toMatchObject({
    status: 'done',
    progress: 100,
    due_date: null,
    start_date: '2026-09-15',
  })
  expect((await fetchDto<ListDto<TaskDto>>('/tasks?workspace_id=ws_01')).total).toBe(10)
})

it('requires the resolver and reports absent approvals or invalid filters', async () => {
  await expect(
    fetchDto('/approvals/ap_01', jsonRequest('PATCH', { status: 'approved' })),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
  await expect(fetchDto('/approvals/missing')).rejects.toMatchObject({
    code: 'APPROVAL_NOT_FOUND',
    status: 404,
  })
  await expect(fetchDto('/approvals')).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
    status: 400,
  })
})
