import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { ListDto } from '@/shared/types/api/envelope'
import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'
import { toTask, toTaskHistory } from './model/mapper'

it('scopes ten tasks and applies all filters before calculating total', async () => {
  const all = await fetchDto<ListDto<TaskDto>>('/tasks?workspace_id=ws_01')
  expect(all.total).toBe(10)
  expect(all.items.map(toTask)[0].id).toBe('tk_05')
  expect(await fetchDto('/tasks?workspace_id=ws_02')).toEqual({ items: [], total: 0 })
  const cases: [string, string[]][] = [
    ['&status=done', ['tk_08', 'tk_09', 'tk_10']],
    ['&assignee_member_id=mb_01&status=in_progress', ['tk_01', 'tk_04']],
    ['&due_after=2026-09-18&due_before=2026-09-24', ['tk_06', 'tk_01', 'tk_03', 'tk_04']],
    ['&due_after=2026-09-10&due_before=2026-09-16', ['tk_07', 'tk_08', 'tk_09', 'tk_02']],
  ]
  for (const [query, ids] of cases) {
    const result = await fetchDto<ListDto<TaskDto>>(`/tasks?workspace_id=ws_01${query}`)
    expect(result.items.map(toTask).map(({ id }) => id)).toEqual(ids)
    expect(result.total).toBe(ids.length)
  }
  await expect(fetchDto('/tasks')).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
  await expect(fetchDto('/tasks?workspace_id=ws_01&status=future')).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
    status: 400,
  })
})

it('creates deterministic tasks, retrieves them and records actual changes', async () => {
  const created = toTask(
    await fetchDto<TaskDto>(
      '/tasks',
      jsonRequest('POST', {
        workspace_id: 'ws_01',
        title: '수동 태스크',
        created_by: 'mb_01',
        start_date: '2026-09-18',
      }),
    ),
  )
  expect(created).toMatchObject({
    id: 'tk_90',
    title: '수동 태스크',
    status: 'todo',
    startDate: '2026-09-18',
  })
  expect((await fetchDto<ListDto<TaskDto>>('/tasks?workspace_id=ws_01')).total).toBe(11)
  await fetchDto(
    `/tasks/${created.id}`,
    jsonRequest('PATCH', { status: 'blocked', blocker: '권한 필요', changed_by: 'mb_01' }),
  )
  expect(toTask(await fetchDto<TaskDto>(`/tasks/${created.id}`))).toMatchObject({
    status: 'blocked',
    blocker: '권한 필요',
  })
  const history = (
    await fetchDto<ListDto<TaskHistoryDto>>(`/tasks/${created.id}/history`)
  ).items.map(toTaskHistory)
  expect(history).toHaveLength(3)
  expect(history.find(({ field }) => field === 'status')).toMatchObject({
    oldValue: 'todo',
    newValue: 'blocked',
    source: 'manual',
    changedBy: 'mb_01',
  })
})

it('starts again with ten tasks after a previous test mutated the DB', async () => {
  expect((await fetchDto<ListDto<TaskDto>>('/tasks?workspace_id=ws_01')).total).toBe(10)
  expect(toTask(await fetchDto<TaskDto>('/tasks/tk_01')).status).toBe('in_progress')
})

it('rolls back a history entry once, restores the field and appends an inverse history', async () => {
  const before = await fetchDto<ListDto<TaskHistoryDto>>('/tasks/tk_01/history')
  expect(before.items.map(toTaskHistory).map(({ id }) => id)).toEqual(['hs_02', 'hs_01'])
  const restored = toTask(
    await fetchDto<TaskDto>('/tasks/tk_01/history/hs_01/rollback?changed_by=mb_01', {
      method: 'POST',
    }),
  )
  expect(restored.dueDate).toBe('2026-09-13')
  const history = (await fetchDto<ListDto<TaskHistoryDto>>('/tasks/tk_01/history')).items.map(
    toTaskHistory,
  )
  expect(history).toHaveLength(3)
  expect(history[0]).toMatchObject({
    oldValue: '2026-09-20',
    newValue: '2026-09-13',
    source: 'meeting',
    changedBy: 'mb_01',
    isAuto: false,
  })
  expect(history.find(({ id }) => id === 'hs_01')).toMatchObject({
    isRolledBack: true,
    rolledBackAt: '2026-09-18T09:00:00+09:00',
  })
  await expect(
    fetchDto('/tasks/tk_01/history/hs_01/rollback', { method: 'POST' }),
  ).rejects.toMatchObject({ code: 'TASK_HISTORY_ALREADY_ROLLED_BACK', status: 409 })
  await expect(
    fetchDto('/tasks/tk_02/history/hs_01/rollback', { method: 'POST' }),
  ).rejects.toMatchObject({ code: 'TASK_HISTORY_NOT_FOUND', status: 404 })
})

it('rejects missing tasks, empty changes, invalid progress and nonexistent workspaces', async () => {
  await expect(fetchDto('/tasks/missing')).rejects.toMatchObject({
    code: 'TASK_NOT_FOUND',
    status: 404,
  })
  await expect(fetchDto('/tasks/tk_01', jsonRequest('PATCH', {}))).rejects.toMatchObject({
    code: 'INVALID_REQUEST',
    status: 400,
  })
  await expect(
    fetchDto('/tasks/tk_01', jsonRequest('PATCH', { progress: 101 })),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
  await expect(
    fetchDto('/tasks', jsonRequest('POST', { workspace_id: 'missing', title: '없음' })),
  ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND', status: 404 })
})
