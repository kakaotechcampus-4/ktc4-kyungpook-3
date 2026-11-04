import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { ApprovalDto } from '@/shared/types/api/approval'
import type { ListDto } from '@/shared/types/api/envelope'
import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'
import { db } from './db'
import { MOCK_NOW } from './fixtures/constants'
import { setMockRole } from './sessions'

const task = (id: string) => db.tasks.find(({ task_id }) => task_id === id)!
const approval = (id: string) => db.approvals.find(({ approval_id }) => approval_id === id)!
const historyOf = (id: string) => db.taskHistory.filter(({ task_id }) => task_id === id)
const item = (id: string) =>
  db.extractions.flatMap(({ items }) => items).find(({ item_id }) => item_id === id)!

/** 쓰기 실패가 아무것도 바꾸지 않았는지 비교할 상태 */
const snapshot = () =>
  structuredClone({
    tasks: db.tasks,
    taskHistory: db.taskHistory,
    approvals: db.approvals,
    extractions: db.extractions,
  })

const patchTask = (id: string, body: Record<string, unknown>) =>
  fetchDto<TaskDto>(`/tasks/${id}`, jsonRequest('PATCH', body))
const resolve = (id: string, body: Record<string, unknown>) =>
  fetchDto<ApprovalDto>(`/approvals/${id}`, jsonRequest('PATCH', body))
const retry = (id: string) =>
  fetchDto<TaskDto>(`/tasks/${id}/notion-sync/retry`, { method: 'POST' })

const overrides = {
  task_title: '알림 문구 검토',
  assignee_member_id: 'mb_02',
  due_date: '2026-09-30',
}

function setNotion(status: 'connected' | 'not_connected' | 'revoked' | 'missing') {
  if (status === 'missing') {
    delete db.integrations.ws_01
    return
  }
  db.integrations.ws_01.notion.status = status
}

function makeUpdateApproval(payload: Record<string, unknown>) {
  const target = approval('ap_01')
  target.type = 'task_update'
  target.related_task_id = 'tk_01'
  target.payload = payload
}

describe('버전과 Notion 반영 상태 (services/tasks.py, notion_sync.enqueue_task_sync)', () => {
  it('실제로 바뀐 필드가 있을 때만 version 이 오르고 연동된 공간이면 pending 이 된다', async () => {
    expect(task('tk_02')).toMatchObject({ version: 1, notion_sync_status: null })
    const changed = await patchTask('tk_02', { status: 'in_progress' })
    expect(changed).toMatchObject({ version: 2, notion_sync_status: 'pending' })
    expect(await patchTask('tk_02', { status: 'done' })).toMatchObject({
      version: 3,
      notion_sync_status: 'pending',
    })
  })

  it('같은 값 변경은 version·Notion 상태·이력·수정 시각을 바꾸지 않는다', async () => {
    const before = structuredClone(task('tk_09'))
    expect(before).toMatchObject({ status: 'done', notion_sync_status: 'synced', version: 1 })
    const historyCount = db.taskHistory.length
    expect(await patchTask('tk_09', { status: 'done', blocker: null })).toEqual(before)
    expect(db.taskHistory).toHaveLength(historyCount)
  })

  it.each(['not_connected', 'revoked', 'missing'] as const)(
    'Notion 이 %s 이면 변경해도 pending 으로 바꾸지 않는다',
    async (status) => {
      setNotion(status)
      expect(await patchTask('tk_01', { blocker: 'review' })).toMatchObject({
        version: 2,
        notion_sync_status: 'synced',
      })
      expect(await patchTask('tk_02', { status: 'blocked' })).toMatchObject({
        version: 2,
        notion_sync_status: null,
      })
    },
  )

  it('생성은 version 1 이고 연동된 공간에서만 pending 이다', async () => {
    expect(
      await fetchDto<TaskDto>(
        '/tasks',
        jsonRequest('POST', { workspace_id: 'ws_01', title: '새 일' }),
      ),
    ).toMatchObject({ version: 1, notion_sync_status: 'pending' })
    // 생성은 PM 의 세션 팀원이 있는 공간에서만 된다 — 연동 안 된 공간은 ws_01 의 연동을 끊어 만든다
    setNotion('not_connected')
    expect(
      await fetchDto<TaskDto>(
        '/tasks',
        jsonRequest('POST', { workspace_id: 'ws_01', title: '새 일' }),
      ),
    ).toMatchObject({ version: 1, notion_sync_status: null })
  })

  it('되돌리기가 성공하면 version 이 오르고 pending 이 된다. 실패하면 그대로다', async () => {
    const restored = await fetchDto<TaskDto>('/tasks/tk_01/history/hs_01/rollback', {
      method: 'POST',
    })
    expect(restored).toMatchObject({
      due_date: '2026-09-13',
      version: 2,
      notion_sync_status: 'pending',
    })
    const before = snapshot()
    await expect(
      fetchDto('/tasks/tk_01/history/hs_01/rollback', { method: 'POST' }),
    ).rejects.toMatchObject({ code: 'TASK_HISTORY_ALREADY_ROLLED_BACK', status: 409 })
    expect(snapshot()).toEqual(before)
  })

  it('미연동 공간의 되돌리기는 version 만 올리고 Notion 상태를 두지 않는다', async () => {
    setNotion('revoked')
    expect(
      await fetchDto<TaskDto>('/tasks/tk_01/history/hs_01/rollback', { method: 'POST' }),
    ).toMatchObject({ version: 2, notion_sync_status: 'synced' })
  })

  it('승인 성공이나 Notion 페이지 ID 로 synced 를 만들지 않는다', async () => {
    const approved = await resolve('ap_01', { status: 'approved', task_overrides: overrides })
    expect(task(approved.related_task_id!)).toMatchObject({
      version: 1,
      notion_sync_status: 'pending',
      notion_page_id: null,
    })
    task('tk_02').notion_page_id = 'notion_tk_02'
    expect(await patchTask('tk_02', { status: 'done' })).toMatchObject({
      notion_sync_status: 'pending',
    })
  })
})

describe('세션 팀원 기록 (본문·쿼리의 changed_by·resolved_by 무시)', () => {
  it('상태 변경·되돌리기·승인 처리는 본문에 다른 ID 가 있어도 mb_01 로 기록한다', async () => {
    await patchTask('tk_02', { status: 'blocked', changed_by: 'mb_04' })
    await fetchDto('/tasks/tk_01/history/hs_01/rollback?changed_by=mb_04', { method: 'POST' })
    makeUpdateApproval({ blocker: '리뷰 대기' })
    await resolve('ap_01', { status: 'approved', resolved_by: 'mb_04' })
    await resolve('ap_02', {
      status: 'approved',
      resolved_by: 'mb_03',
      task_overrides: { ...overrides, task_title: '테스트 계획 정리' },
    })
    await resolve('ap_03', { status: 'rejected', resolved_by: 'mb_02' })

    // 변경·되돌리기·변경 승인·생성 승인이 한 줄씩 남는다. 반려는 이력을 남기지 않는다
    const written = db.taskHistory.slice(-5)
    expect(written.map(({ task_id, changed_field }) => [task_id, changed_field])).toEqual([
      ['tk_02', 'status'],
      ['tk_01', 'due_date'],
      ['tk_01', 'blocker'],
      ['tk_90', 'title'],
      ['tk_90', 'due_date'],
    ])
    for (const entry of written) expect(entry.changed_by).toBe('mb_01')
    expect(db.taskHistory.map(({ changed_by }) => changed_by)).not.toContain('mb_04')
    expect(db.taskHistory.map(({ changed_by }) => changed_by)).not.toContain('mb_03')
    for (const id of ['ap_01', 'ap_02', 'ap_03']) expect(approval(id).resolved_by).toBe('mb_01')
  })

  it('세션 팀원 대응이 없는 공간의 쓰기는 PM 이어도 403 이고 아무것도 바꾸지 않는다', async () => {
    // 그 공간의 태스크는 생성 API 로 만들 수 없어(아래 POST 가 403) db 에 직접 둔다
    const created: TaskDto = {
      ...structuredClone(task('tk_02')),
      task_id: 'tk_80',
      workspace_id: 'ws_02',
      assignee_member_id: null,
      meeting_id: null,
    }
    db.tasks.push(created)
    db.approvals.push({
      ...structuredClone(approval('ap_03')),
      approval_id: 'ap_80',
      workspace_id: 'ws_02',
      payload: { task_title: '사이드 승인' },
    })
    setMockRole('pm', 'ws_02')
    const before = snapshot()
    await expect(patchTask(created.task_id, { status: 'done' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
    await expect(resolve('ap_80', { status: 'rejected' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
    await expect(
      fetchDto('/tasks', jsonRequest('POST', { workspace_id: 'ws_02', title: '사이드 일' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    expect(snapshot()).toEqual(before)
  })

  it('태스크 생성은 본문 created_by 가 아니라 세션 팀원 mb_01 을 생성자로 남긴다', async () => {
    const created = await fetchDto<TaskDto>(
      '/tasks',
      jsonRequest('POST', { workspace_id: 'ws_01', title: '회고 정리', created_by: 'mb_04' }),
    )
    expect(historyOf(created.task_id)).toEqual([
      expect.objectContaining({
        changed_field: 'title',
        new_value: '회고 정리',
        changed_by: 'mb_01',
      }),
    ])
  })
})

describe('PM 쓰기와 소속 조회', () => {
  it('일반 팀원의 쓰기(생성 포함)는 403 이고 태스크·승인·이력·추출이 그대로다', async () => {
    task('tk_04').notion_sync_status = 'failed'
    setMockRole('member')
    const before = snapshot()
    const writes: [string, () => Promise<unknown>][] = [
      [
        'POST task',
        () =>
          fetchDto(
            '/tasks',
            jsonRequest('POST', { workspace_id: 'ws_01', title: '새 일', created_by: 'mb_01' }),
          ),
      ],
      ['PATCH task', () => patchTask('tk_01', { status: 'done', changed_by: 'mb_01' })],
      [
        'rollback',
        () => fetchDto('/tasks/tk_01/history/hs_01/rollback?changed_by=mb_01', { method: 'POST' }),
      ],
      ['retry', () => retry('tk_04')],
      ['approve', () => resolve('ap_01', { status: 'approved', task_overrides: overrides })],
      ['reject', () => resolve('ap_02', { status: 'rejected', resolved_by: 'mb_01' })],
    ]
    for (const [name, write] of writes)
      await expect(write(), name).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    expect(snapshot()).toEqual(before)
  })

  it('일반 팀원도 태스크 목록·상세·이력과 승인 목록·상세는 조회한다', async () => {
    setMockRole('member')
    expect((await fetchDto<ListDto<TaskDto>>('/tasks?workspace_id=ws_01')).total).toBe(10)
    await expect(fetchDto('/tasks/tk_01')).resolves.toMatchObject({ task_id: 'tk_01' })
    expect((await fetchDto<ListDto<TaskHistoryDto>>('/tasks/tk_01/history')).total).toBe(2)
    expect((await fetchDto<ListDto<ApprovalDto>>('/approvals?workspace_id=ws_01')).total).toBe(3)
    await expect(fetchDto('/approvals/ap_01')).resolves.toMatchObject({ approval_id: 'ap_01' })
  })

  it('소속이 아닌 공간의 조회는 403, 비로그인은 401 이다', async () => {
    db.accounts[0].workspaceIds = ['ws_02']
    for (const path of [
      '/tasks?workspace_id=ws_01',
      '/tasks/tk_01',
      '/tasks/tk_01/history',
      '/approvals?workspace_id=ws_01',
      '/approvals/ap_01',
    ])
      await expect(fetchDto(path), path).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    db.authenticated = false
    const before = snapshot()
    await expect(fetchDto('/tasks?workspace_id=ws_01')).rejects.toMatchObject({ status: 401 })
    await expect(patchTask('tk_01', { status: 'done' })).rejects.toMatchObject({ status: 401 })
    await expect(
      fetchDto('/tasks', jsonRequest('POST', { workspace_id: 'ws_01', title: '새 일' })),
    ).rejects.toMatchObject({ status: 401 })
    await expect(resolve('ap_01', { status: 'rejected' })).rejects.toMatchObject({ status: 401 })
    expect(snapshot()).toEqual(before)
  })
})

describe('생성 승인 보완', () => {
  it('유효한 보완값이면 그 제목(trim)·담당자·마감으로 태스크 하나를 만들고 추출 항목에 잇는다', async () => {
    const taskCount = db.tasks.length
    const approved = await resolve('ap_01', {
      status: 'approved',
      task_overrides: { ...overrides, task_title: '  보완한 제목  ' },
    })
    expect(approved).toMatchObject({
      status: 'approved',
      related_task_id: 'tk_90',
      resolved_by: 'mb_01',
      resolved_at: MOCK_NOW,
    })
    expect(db.tasks).toHaveLength(taskCount + 1)
    expect(task('tk_90')).toMatchObject({
      workspace_id: 'ws_01',
      meeting_id: 'mt_09',
      title: '보완한 제목',
      assignee_member_id: 'mb_02',
      due_date: '2026-09-30',
      version: 1,
    })
    expect(historyOf('tk_90')).toEqual([
      expect.objectContaining({
        changed_field: 'title',
        new_value: '알림 문구 검토',
        changed_by: 'mb_01',
        change_source: 'meeting',
      }),
      expect.objectContaining({
        changed_field: 'title',
        old_value: '알림 문구 검토',
        new_value: '보완한 제목',
        changed_by: 'mb_01',
        change_source: 'manual',
      }),
      expect.objectContaining({
        changed_field: 'assignee',
        old_value: null,
        new_value: 'mb_02',
        changed_by: 'mb_01',
        change_source: 'manual',
      }),
      expect.objectContaining({
        changed_field: 'due_date',
        old_value: null,
        new_value: '2026-09-30',
        changed_by: 'mb_01',
        change_source: 'manual',
      }),
    ])
    expect(item('it_04')).toMatchObject({ task_id: 'tk_90', approval_id: 'ap_01' })
    // 보완값은 승인 payload 를 바꾸지 않는다
    expect(approval('ap_01').payload).toMatchObject({ assignee_member_id: null, due_date: null })
  })

  it('보완값이 없어도 payload 의 최종 세 값이 유효하면 승인한다', async () => {
    approval('ap_02').payload.due_date = '2026-09-28'
    await resolve('ap_02', { status: 'approved' })
    expect(task('tk_90')).toMatchObject({
      title: '테스트 계획 정리',
      assignee_member_id: 'mb_02',
      due_date: '2026-09-28',
    })
  })

  it('제목은 코드 포인트로 1~300자다', async () => {
    await resolve('ap_01', {
      status: 'approved',
      task_overrides: { ...overrides, task_title: '😀'.repeat(300) },
    })
    expect([...task('tk_90').title]).toHaveLength(300)
  })

  it.each<[string, unknown, string, number]>([
    ['공백뿐인 제목', { ...overrides, task_title: '   ' }, 'INVALID_REQUEST', 400],
    ['301자 제목', { ...overrides, task_title: '가'.repeat(301) }, 'INVALID_REQUEST', 400],
    ['빈 담당자', { ...overrides, assignee_member_id: '' }, 'MEMBER_NOT_FOUND', 404],
    ['없는 담당자', { ...overrides, assignee_member_id: 'mb_99' }, 'MEMBER_NOT_FOUND', 404],
    ['다른 공간 담당자', { ...overrides, assignee_member_id: 'mb_80' }, 'WORKSPACE_MISMATCH', 400],
    ['달력에 없는 날짜', { ...overrides, due_date: '2026-02-30' }, 'INVALID_REQUEST', 400],
    ['형식이 다른 날짜', { ...overrides, due_date: '2026/09/30' }, 'INVALID_REQUEST', 400],
    ['서버 범위 밖 0000년 날짜', { ...overrides, due_date: '0000-01-01' }, 'INVALID_REQUEST', 400],
    ['객체가 아닌 보완', 'title', 'INVALID_REQUEST', 400],
  ])('%s 는 실패하고 부분 변경이 없다', async (_, taskOverrides, code, status) => {
    db.members.push({
      ...structuredClone(db.members[1]),
      member_id: 'mb_80',
      workspace_id: 'ws_02',
    })
    const before = snapshot()
    await expect(
      resolve('ap_01', { status: 'approved', task_overrides: taskOverrides }),
    ).rejects.toMatchObject({ code, status })
    expect(snapshot()).toEqual(before)
    expect(approval('ap_01')).toMatchObject({ status: 'pending', resolved_by: null })
  })

  it('잘못된 연결 회의는 기존 소속 검사대로 실패하고 부분 변경이 없다', async () => {
    approval('ap_01').payload.meeting_id = 'mt_99'
    const before = snapshot()
    await expect(
      resolve('ap_01', { status: 'approved', task_overrides: overrides }),
    ).rejects.toMatchObject({ code: 'MEETING_NOT_FOUND', status: 404 })
    expect(snapshot()).toEqual(before)
  })

  it('반려에 보완값을 보내면 400이고 부분 변경이 없다', async () => {
    const before = snapshot()
    await expect(
      resolve('ap_01', { status: 'rejected', task_overrides: overrides }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
    expect(snapshot()).toEqual(before)
  })

  it('두 번째 처리는 409 APPROVAL_ALREADY_RESOLVED 와 current_status 이고 아무것도 다시 만들지 않는다', async () => {
    await resolve('ap_01', { status: 'approved', task_overrides: overrides })
    await resolve('ap_02', { status: 'rejected' })
    const before = snapshot()
    for (const [id, current] of [
      ['ap_01', 'approved'],
      ['ap_02', 'rejected'],
    ])
      for (const body of [
        { status: 'approved', task_overrides: overrides },
        { status: 'rejected' },
      ])
        await expect(resolve(id, body)).rejects.toMatchObject({
          code: 'APPROVAL_ALREADY_RESOLVED',
          status: 409,
          details: { approval_id: id, current_status: current },
        })
    expect(snapshot()).toEqual(before)
  })

  it('변경 승인에서 생성 보완 키를 보내면 400이고 부분 변경이 없다', async () => {
    makeUpdateApproval({ title: '제안 제목' })
    const before = snapshot()
    await expect(
      resolve('ap_01', { status: 'approved', task_overrides: overrides }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
    expect(snapshot()).toEqual(before)
  })
})

describe('날짜 연도 범위 (services/tasks.parse_date — date.fromisoformat 은 1~9999년)', () => {
  it('변경 승인의 제안 마감 0000-01-01 은 400 INVALID_REQUEST 이고 아무것도 바꾸지 않는다', async () => {
    makeUpdateApproval({ due_date: '0000-01-01' })
    const before = snapshot()
    await expect(resolve('ap_01', { status: 'approved' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400,
    })
    expect(snapshot()).toEqual(before)
    expect(approval('ap_01')).toMatchObject({ status: 'pending', resolved_by: null })
  })

  it.each(['due_date', 'start_date'])(
    '태스크 PATCH 의 %s 0000-01-01 은 400 INVALID_REQUEST 이고 아무것도 바꾸지 않는다',
    async (field) => {
      const before = snapshot()
      await expect(patchTask('tk_02', { [field]: '0000-01-01' })).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
        status: 400,
      })
      expect(snapshot()).toEqual(before)
    },
  )

  it.each(['due_before', 'due_after'])('태스크 목록의 %s 0000-01-01 은 400 이다', async (key) => {
    await expect(fetchDto(`/tasks?workspace_id=ws_01&${key}=0000-01-01`)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400,
    })
  })

  it('0001-01-01 과 9999-12-31 은 유효한 날짜로 받는다', async () => {
    const approved = await resolve('ap_02', {
      status: 'approved',
      task_overrides: { ...overrides, due_date: '0001-01-01' },
    })
    expect(task(approved.related_task_id!).due_date).toBe('0001-01-01')
    expect(
      await patchTask('tk_02', { start_date: '0001-01-01', due_date: '9999-12-31' }),
    ).toMatchObject({ start_date: '0001-01-01', due_date: '9999-12-31' })
    makeUpdateApproval({ due_date: '9999-12-31' })
    await resolve('ap_01', { status: 'approved' })
    expect(task('tk_01').due_date).toBe('9999-12-31')
  })
})

describe('변경 승인 충돌 (approvals._find_conflicts, confirm_task_version)', () => {
  const conflictPayload = {
    status: 'done',
    base_values: { status: 'todo' },
  }

  it('제안 뒤 바뀐 필드는 409 APPROVAL_CONFLICT 이고 승인·태스크·이력이 그대로다', async () => {
    makeUpdateApproval(conflictPayload)
    const before = snapshot()
    await expect(resolve('ap_01', { status: 'approved' })).rejects.toMatchObject({
      code: 'APPROVAL_CONFLICT',
      status: 409,
      details: {
        approval_id: 'ap_01',
        task_id: 'tk_01',
        task_version: 1,
        conflicts: [{ field: 'status', base: 'todo', current: 'in_progress', proposed: 'done' }],
      },
    })
    expect(snapshot()).toEqual(before)
    expect(approval('ap_01').status).toBe('pending')
  })

  it('confirm_task_version 이 지금 버전과 같을 때만 덮어쓰고, 그 사이 바뀌었으면 다시 충돌이다', async () => {
    makeUpdateApproval(conflictPayload)
    await expect(
      resolve('ap_01', { status: 'approved', confirm_task_version: 2 }),
    ).rejects.toMatchObject({ code: 'APPROVAL_CONFLICT', details: { task_version: 1 } })

    // 충돌을 본 뒤(버전 1) 다른 변경이 끼어든다
    await patchTask('tk_01', { blocker: '리뷰 대기' })
    const before = snapshot()
    await expect(
      resolve('ap_01', { status: 'approved', confirm_task_version: 1 }),
    ).rejects.toMatchObject({
      code: 'APPROVAL_CONFLICT',
      status: 409,
      details: { task_version: 2, conflicts: [{ field: 'status' }] },
    })
    // 자동으로 다시 시도하거나 일부만 반영하지 않는다
    expect(snapshot()).toEqual(before)

    const approved = await resolve('ap_01', { status: 'approved', confirm_task_version: 2 })
    expect(approved).toMatchObject({ status: 'approved', resolved_by: 'mb_01' })
    expect(task('tk_01')).toMatchObject({
      status: 'done',
      blocker: '리뷰 대기',
      version: 3,
      notion_sync_status: 'pending',
    })
    expect(historyOf('tk_01').at(-1)).toMatchObject({
      changed_field: 'status',
      change_source: 'meeting',
      changed_by: 'mb_01',
    })
  })

  it.each<[string, Record<string, unknown>]>([
    ['base_values 가 없는 요청', { status: 'done' }],
    ['base_values 에 그 필드가 없는 요청', { status: 'done', base_values: { blocker: null } }],
    ['지금 값이 base 와 같은 요청', { status: 'done', base_values: { status: 'in_progress' } }],
  ])('%s 은 confirm_task_version 없이 반영한다', async (_, payload) => {
    makeUpdateApproval(payload)
    await resolve('ap_01', { status: 'approved' })
    expect(task('tk_01')).toMatchObject({ status: 'done', version: 2 })
  })

  it('지금 값이 이미 제안 값과 같으면 충돌이 아니고 바뀐 것이 없어 버전도 그대로다', async () => {
    task('tk_01').status = 'done'
    makeUpdateApproval({ status: 'done', base_values: { status: 'todo' } })
    expect(await resolve('ap_01', { status: 'approved' })).toMatchObject({ status: 'approved' })
    expect(task('tk_01')).toMatchObject({
      status: 'done',
      version: 1,
      notion_sync_status: 'synced',
    })
  })
})

describe('Notion 반영 재시도 (POST /tasks/{id}/notion-sync/retry)', () => {
  it('failed 이고 연동된 태스크는 빈 본문 POST 로 pending 이 된다', async () => {
    task('tk_04').notion_sync_status = 'failed'
    const before = structuredClone(task('tk_04'))
    expect(await retry('tk_04')).toEqual({ ...before, notion_sync_status: 'pending' })
    expect(historyOf('tk_04')).toEqual([])
  })

  it.each(['not_connected', 'revoked', 'missing'] as const)(
    'Notion 이 %s 이면 409 INTEGRATION_NOT_CONNECTED 이고 failed 를 유지한다',
    async (status) => {
      task('tk_04').notion_sync_status = 'failed'
      setNotion(status)
      const before = snapshot()
      await expect(retry('tk_04')).rejects.toMatchObject({
        code: 'INTEGRATION_NOT_CONNECTED',
        status: 409,
      })
      expect(snapshot()).toEqual(before)
    },
  )

  it.each(['pending', 'synced', null])('상태가 %s 이면 400 이고 그대로다', async (status) => {
    task('tk_04').notion_sync_status = status
    const before = snapshot()
    await expect(retry('tk_04')).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
    expect(snapshot()).toEqual(before)
  })

  it('없는 태스크는 404 다', async () => {
    await expect(retry('missing')).rejects.toMatchObject({ code: 'TASK_NOT_FOUND', status: 404 })
  })
})

describe('PR307 partial edits and history', () => {
  it('keeps original proposal, stores only changed normalized fields and attributes edits to the PM', async () => {
    approval('ap_02').payload.change_source = 'chat'
    approval('ap_02').payload.due_date = '2026-09-30'
    await resolve('ap_02', {
      status: 'approved',
      task_overrides: {
        task_title: '  최종 제목  ',
        assignee_member_id: null,
        due_date: '20260930',
      },
    })
    expect(approval('ap_02').payload).toMatchObject({
      task_title: '테스트 계획 정리',
      assignee_member_id: 'mb_02',
      due_date: '2026-09-30',
      task_overrides: { task_title: '최종 제목', assignee_member_id: null },
    })
    expect(approval('ap_02').payload.task_overrides).not.toHaveProperty('due_date')
    expect(historyOf('tk_90')).toEqual([
      expect.objectContaining({
        changed_field: 'title',
        old_value: null,
        new_value: '테스트 계획 정리',
        change_source: 'chat',
        changed_by: 'mb_01',
      }),
      expect.objectContaining({
        changed_field: 'title',
        old_value: '테스트 계획 정리',
        new_value: '최종 제목',
        change_source: 'manual',
        changed_by: 'mb_01',
      }),
      expect.objectContaining({
        changed_field: 'assignee',
        old_value: 'mb_02',
        new_value: null,
        change_source: 'manual',
        changed_by: 'mb_01',
      }),
    ])
  })
  it('compares conflicts against the final edited value and preserves untouched uneditable changes', async () => {
    makeUpdateApproval({
      status: 'done',
      blocker: '제안 사유',
      change_source: 'checkin',
      base_values: { status: 'todo' },
    })
    await resolve('ap_01', {
      status: 'approved',
      task_overrides: { status: 'in_progress', due_date: null },
    })
    expect(task('tk_01')).toMatchObject({
      status: 'in_progress',
      due_date: null,
      blocker: '제안 사유',
    })
    expect(approval('ap_01').payload).toMatchObject({
      status: 'done',
      blocker: '제안 사유',
      task_overrides: { status: 'in_progress', due_date: null },
    })
    expect(historyOf('tk_01').slice(-2)).toEqual([
      expect.objectContaining({
        changed_field: 'blocker',
        change_source: 'checkin',
        changed_by: 'mb_01',
      }),
      expect.objectContaining({
        changed_field: 'due_date',
        change_source: 'manual',
        changed_by: 'mb_01',
      }),
    ])
  })
  it.each([
    ['task_create', { status: 'done' }],
    ['task_create', { title: '잘못된 키' }],
    ['task_update', { assignee_member_id: null }],
    ['task_update', { progress: 90 }],
    ['reminder_dm', { due_date: null }],
    ['task_update', { status: null }],
  ])('rejects illegal %s edits atomically', async (type, edits) => {
    Object.assign(approval('ap_01'), {
      type,
      related_task_id: type === 'task_update' ? 'tk_01' : null,
    })
    const before = snapshot()
    await expect(
      resolve('ap_01', { status: 'approved', task_overrides: edits }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
    expect(snapshot()).toEqual(before)
  })
  it('keeps legacy progress history readable but rejects rollback without mutating state', async () => {
    db.taskHistory.push({
      ...db.taskHistory[0],
      history_id: 'hs_legacy',
      changed_field: 'progress',
      old_value: '20',
      new_value: '40',
    })
    const before = snapshot()
    const history = await fetchDto<ListDto<TaskHistoryDto>>('/tasks/tk_01/history')
    expect(history.items).toContainEqual(
      expect.objectContaining({ changed_field: 'progress', old_value: '20', new_value: '40' }),
    )
    await expect(
      fetchDto('/tasks/tk_01/history/hs_legacy/rollback', { method: 'POST' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
    expect(snapshot()).toEqual(before)
    expect(task('tk_01')).not.toHaveProperty('progress')
  })
})
