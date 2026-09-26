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

// PR #55 가 백엔드의 exclude_none 을 뺐다. 명시적 null 이 무시가 아니라 필드 해제다 (계약 §2.6)
it('clears a field when PATCH carries an explicit null and records it as a change', async () => {
  const cleared = toTask(
    await fetchDto<TaskDto>(
      '/tasks/tk_01',
      jsonRequest('PATCH', { due_date: null, blocker: null, changed_by: 'mb_01' }),
    ),
  )
  expect(cleared.dueDate).toBeNull()
  const history = (await fetchDto<ListDto<TaskHistoryDto>>('/tasks/tk_01/history')).items.map(
    toTaskHistory,
  )
  expect(history[0]).toMatchObject({
    field: 'due_date',
    oldValue: '2026-09-20',
    newValue: null,
    changedBy: 'mb_01',
  })
  // 이미 null 인 blocker 는 바뀐 것이 없으므로 이력을 남기지 않는다
  expect(history.filter(({ field }) => field === 'blocker')).toHaveLength(0)
})

// title·status 는 NOT NULL 이라 백엔드 validate_task_fields 가 400 을 낸다
it('refuses an explicit null for the fields the backend cannot clear', async () => {
  for (const body of [{ title: null }, { status: null }]) {
    await expect(fetchDto('/tasks/tk_01', jsonRequest('PATCH', body))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400,
    })
  }
  expect(toTask(await fetchDto<TaskDto>('/tasks/tk_01'))).toMatchObject({
    title: '로그인 API 연동',
    status: 'in_progress',
  })
})

// ChangedField.START_DATE 가 생겨서 시작일도 이력·되돌리기 대상이다 (계약 §4.7-6)
it('records a start date change as its own history field and rolls it back', async () => {
  await fetchDto(
    '/tasks/tk_01',
    jsonRequest('PATCH', { start_date: '2026-10-01', changed_by: 'mb_01' }),
  )
  const entry = (await fetchDto<ListDto<TaskHistoryDto>>('/tasks/tk_01/history')).items.map(
    toTaskHistory,
  )[0]
  expect(entry).toMatchObject({
    field: 'start_date',
    oldValue: '2026-09-15',
    newValue: '2026-10-01',
  })
  const restored = toTask(
    await fetchDto<TaskDto>(`/tasks/tk_01/history/${entry.id}/rollback`, { method: 'POST' }),
  )
  expect(restored.startDate).toBe('2026-09-15')
})

// 되돌리기 충돌 감지 (PR #55). 그 이력 이후에 다른 변경이 있으면 순서를 건너뛸 수 없다
it('refuses to roll back a history entry that a later change has superseded', async () => {
  await fetchDto('/tasks/tk_01', jsonRequest('PATCH', { due_date: '2026-09-30' }))
  await expect(
    fetchDto('/tasks/tk_01/history/hs_01/rollback', { method: 'POST' }),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
  expect(toTask(await fetchDto<TaskDto>('/tasks/tk_01')).dueDate).toBe('2026-09-30')
})

// 백엔드 validate_workspace_ownership 과 같다. Task 에 연결하는 ID 의 소속을 본다
it('refuses ids that do not exist or belong to another workspace', async () => {
  const cases: [Record<string, unknown>, string, number][] = [
    [{ assignee_member_id: 'mb_99' }, 'MEMBER_NOT_FOUND', 404],
    [{ meeting_id: 'mt_99' }, 'MEETING_NOT_FOUND', 404],
  ]
  for (const [extra, code, status] of cases) {
    await expect(
      fetchDto(
        '/tasks',
        jsonRequest('POST', { workspace_id: 'ws_01', title: '연결 확인', ...extra }),
      ),
    ).rejects.toMatchObject({ code, status })
  }
  // ws_02 에는 태스크가 없으므로 ws_01 의 팀원을 붙이면 워크스페이스가 어긋난다
  await expect(
    fetchDto(
      '/tasks',
      jsonRequest('POST', {
        workspace_id: 'ws_02',
        title: '남의 팀원',
        assignee_member_id: 'mb_01',
      }),
    ),
  ).rejects.toMatchObject({ code: 'WORKSPACE_MISMATCH', status: 400 })
  await expect(
    fetchDto('/tasks/tk_01', jsonRequest('PATCH', { assignee_member_id: 'mb_99' })),
  ).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND', status: 404 })
  expect((await fetchDto<ListDto<TaskDto>>('/tasks?workspace_id=ws_01')).total).toBe(10)
})

// 백엔드는 title.strip() 이 비면 400 이다. 공백만 있는 제목이 통과하면 안 된다
it('refuses a title that is only whitespace', async () => {
  for (const body of [{ title: '   ' }, { title: '   ' }]) {
    await expect(fetchDto('/tasks/tk_01', jsonRequest('PATCH', body))).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400,
    })
  }
  await expect(
    fetchDto('/tasks', jsonRequest('POST', { workspace_id: 'ws_01', title: '  ' })),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
  expect(toTask(await fetchDto<TaskDto>('/tasks/tk_01')).title).toBe('로그인 API 연동')
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
