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

// 백엔드 _apply_approval 은 payload 의 status·progress 도 읽고 validate_task_fields 를 거친다
it('honours status and progress in a task_create payload and rejects invalid ones', async () => {
  db.approvals[0].payload = {
    ...db.approvals[0].payload,
    status: 'in_progress',
    progress: 30,
  }
  await fetchDto(
    '/approvals/ap_01',
    jsonRequest('PATCH', { status: 'approved', resolved_by: 'mb_01' }),
  )
  expect(await fetchDto<TaskDto>('/tasks/tk_90')).toMatchObject({
    status: 'in_progress',
    progress: 30,
  })
})

it('refuses an approval whose payload carries an invalid status or progress', async () => {
  db.approvals[1].payload = { ...db.approvals[1].payload, progress: 200 }
  await expect(
    fetchDto(
      '/approvals/ap_02',
      jsonRequest('PATCH', { status: 'approved', resolved_by: 'mb_01' }),
    ),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
  // 실패한 승인은 그대로 pending 이고 태스크도 생기지 않는다
  expect(
    (await fetchDto<ListDto<ApprovalDto>>('/approvals?workspace_id=ws_01&status=pending')).total,
  ).toBe(3)
  expect((await fetchDto<ListDto<TaskDto>>('/tasks?workspace_id=ws_01')).total).toBe(10)
})

// 백엔드 _apply_approval 은 Task 를 만들기 전에 _get_linkable_extraction_item 으로
// extraction_item_id 의 워크스페이스(추출 → 회의)와 approval_id 를 확인한다 (api/approvals.py).
// 거절되면 커밋되지 않으므로 Task · 승인 · 추출 항목이 모두 그대로다
describe('task_create approval linking an extraction item', () => {
  const approve = () =>
    fetchDto<ApprovalDto>(
      '/approvals/ap_01',
      jsonRequest('PATCH', { status: 'approved', resolved_by: 'mb_01' }),
    )
  const allItems = () => db.extractions.flatMap(({ items }) => items)
  const snapshot = () => ({
    taskCount: db.tasks.length,
    itemTaskIds: allItems().map(({ item_id, task_id }) => [item_id, task_id]),
    approval: db.approvals
      .filter(({ approval_id }) => approval_id === 'ap_01')
      .map(({ status, related_task_id }) => ({ status, related_task_id })),
  })
  // ws_02 회의에서 나온, ap_01 에 연결된 추출 항목을 만든다
  const addForeignWorkspaceItem = () => {
    db.meetings.push({
      meeting_id: 'mt_90',
      workspace_id: 'ws_02',
      title: '다른 워크스페이스 회의',
      status: 'done',
      started_at: '2026-09-15T05:00:00Z',
      ended_at: '2026-09-15T05:30:00Z',
      extraction_id: 'ex_90',
      failed_stage: null,
    })
    const [source] = allItems()
    db.extractions.push({
      extraction_id: 'ex_90',
      meeting_id: 'mt_90',
      items: [
        { ...structuredClone(source), item_id: 'it_90', task_id: null, approval_id: 'ap_01' },
      ],
    })
    db.approvals[0].payload = { ...db.approvals[0].payload, extraction_item_id: 'it_90' }
  }

  it('refuses an item that belongs to another approval and changes nothing', async () => {
    db.approvals[0].payload = { ...db.approvals[0].payload, extraction_item_id: 'it_05' }
    const before = snapshot()
    await expect(approve()).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400,
      message: '추출 항목이 이 승인 요청에 연결되어 있지 않습니다.',
    })
    expect(snapshot()).toEqual(before)
    expect(before.approval).toEqual([{ status: 'pending', related_task_id: null }])
  })

  it('refuses an item from another workspace and changes nothing', async () => {
    addForeignWorkspaceItem()
    const before = snapshot()
    await expect(approve()).rejects.toMatchObject({
      code: 'WORKSPACE_MISMATCH',
      status: 400,
      message: '승인 요청의 워크스페이스와 추출 항목의 워크스페이스가 다릅니다.',
    })
    expect(snapshot()).toEqual(before)
    expect(before.approval).toEqual([{ status: 'pending', related_task_id: null }])
  })

  it('approves without linking when the item does not exist', async () => {
    db.approvals[0].payload = { ...db.approvals[0].payload, extraction_item_id: 'it_99' }
    const before = snapshot()
    expect(await approve()).toMatchObject({ status: 'approved', related_task_id: 'tk_90' })
    expect(db.tasks).toHaveLength(before.taskCount + 1)
    expect(snapshot().itemTaskIds).toEqual(before.itemTaskIds)
  })

  it('checks the item before validating the task fields', async () => {
    addForeignWorkspaceItem()
    db.approvals[0].payload = { ...db.approvals[0].payload, task_title: '', title: '' }
    await expect(approve()).rejects.toMatchObject({ code: 'WORKSPACE_MISMATCH', status: 400 })
  })

  it('records the new task only on the linked item', async () => {
    const before = snapshot()
    await approve()
    expect(snapshot().itemTaskIds).toEqual(
      before.itemTaskIds.map(([itemId, taskId]) => [itemId, itemId === 'it_04' ? 'tk_90' : taskId]),
    )
    // approval_id 는 비우지 않는다 (계약 §3.1, §4.0-②-12)
    expect(allItems().find(({ item_id }) => item_id === 'it_04')?.approval_id).toBe('ap_01')
  })
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

// 백엔드 apply_task_updates 는 값 검증 뒤 담당자 소속을 본다 (services/tasks.py)
it('refuses a task_update approval whose assignee does not exist', async () => {
  db.approvals[0].type = 'task_update'
  db.approvals[0].related_task_id = 'tk_01'
  db.approvals[0].payload = { assignee_member_id: 'mb_99' }
  await expect(
    fetchDto(
      '/approvals/ap_01',
      jsonRequest('PATCH', { status: 'approved', resolved_by: 'mb_01' }),
    ),
  ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND', status: 404 })

  // 실패했으므로 태스크도 승인도 그대로다
  expect(await fetchDto<TaskDto>('/tasks/tk_01')).toMatchObject({ assignee_member_id: 'mb_01' })
  expect(
    (await fetchDto<ListDto<ApprovalDto>>('/approvals?workspace_id=ws_01&status=pending')).total,
  ).toBe(3)
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
