import { fetchDto, fetchSessionDto, jsonRequest } from '@/shared/test/api'
import type { ApprovalDto } from '@/shared/types/api/approval'
import type { ListDto } from '@/shared/types/api/envelope'
import type { ExtractionDto } from '@/shared/types/api/extraction'
import type { TaskDto } from '@/shared/types/api/task'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { db, initialDb, replaceDb, resetDb } from './db'
import { MOCK_DB_VERSION, restoreDb, saveDb } from './persistence'
import {
  BROWSER_DEFAULT_SCENARIO,
  MOCK_SCENARIOS,
  applyScenario,
  createScenarioDb,
} from './scenarios'
import type { MockScenario } from './scenarios'

/*
 * M6 태스크·승인 시나리오. 각 시나리오가 기대한 시작 상태인지와, 그 상태에서 handler 전이가 맞는지 본다.
 * 브라우저 데모는 이 시작 상태를 sessionStorage 로 이어 간다(persistence.ts).
 */

const M6_SCENARIOS = [
  'tasks-default',
  'tasks-empty',
  'approval-needs-input',
  'approval-rejected',
  'approval-resolved',
  'approval-conflict',
  'notion-sync-pending',
  'notion-sync-failed',
  'tasks-member',
] as const satisfies readonly MockScenario[]

afterEach(() => sessionStorage.clear())

const tasks = () => fetchDto<ListDto<TaskDto>>('/tasks?workspace_id=ws_01')
const pending = () => fetchDto<ListDto<ApprovalDto>>('/approvals?workspace_id=ws_01&status=pending')
const resolve = (id: string, body: Record<string, unknown>) =>
  fetchDto<ApprovalDto>(`/approvals/${id}`, jsonRequest('PATCH', body))
const retry = (id: string) =>
  fetchDto<TaskDto>(`/tasks/${id}/notion-sync/retry`, { method: 'POST' })
const extractionItems = async () =>
  (await fetchDto<ExtractionDto>('/extractions/ex_01')).items.map(
    ({ item_id, task_id, approval_id }) => ({ item_id, task_id, approval_id }),
  )

async function role() {
  const { items } = await fetchDto<ListDto<WorkspaceDto>>('/workspaces')
  return items.map(({ workspace_id, role: value }) => [workspace_id, value])
}

describe('M6 시나리오 목록', () => {
  it('모두 등록돼 있고 ws_01 하나에 로그인한다', async () => {
    for (const scenario of M6_SCENARIOS) {
      expect(MOCK_SCENARIOS).toContain(scenario)
      applyScenario(scenario)
      await expect(fetchSessionDto()).resolves.toMatchObject({
        workspace_count: 1,
        last_workspace_id: 'ws_01',
      })
    }
  })

  it('브라우저 기본은 비로그인이고 Vitest 기본 상태는 바뀌지 않는다', () => {
    expect(BROWSER_DEFAULT_SCENARIO).toBe('signed-out')
    resetDb()
    expect(db.tasks.find(({ task_id }) => task_id === 'tk_04')?.notion_sync_status).toBeNull()
    expect(db.approvals.map(({ approval_id }) => approval_id)).toEqual(['ap_01', 'ap_02', 'ap_03'])
    expect(db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_01')?.role).toBe('pm')
  })

  it.each(M6_SCENARIOS)('%s 는 저장 버전 그대로 sessionStorage 에서 복원된다', (scenario) => {
    expect(MOCK_DB_VERSION).toBe(2)
    replaceDb(createScenarioDb(scenario))
    saveDb(sessionStorage)
    resetDb()
    expect(restoreDb(sessionStorage)).toBe(true)
    expect(db).toEqual(createScenarioDb(scenario))
  })
})

describe('M6 시나리오 상태와 전이', () => {
  it('tasks-default: 태스크 10개와 보완이 필요한 대기 생성 승인 3개다', async () => {
    applyScenario('tasks-default')
    expect(await role()).toEqual([['ws_01', 'pm']])
    expect((await tasks()).total).toBe(10)
    expect((await pending()).items.map(({ approval_id }) => approval_id)).toEqual([
      'ap_03',
      'ap_02',
      'ap_01',
    ])
  })

  it('tasks-empty: 태스크·승인이 없고 추출 항목도 없는 것을 가리키지 않는다', async () => {
    applyScenario('tasks-empty')
    expect(await tasks()).toEqual({ items: [], total: 0 })
    expect(await pending()).toEqual({ items: [], total: 0 })
    for (const entry of await extractionItems())
      expect(entry).toMatchObject({ task_id: null, approval_id: null })
  })

  it('approval-needs-input: 제목·담당자·마감이 비어 보완 없이는 400, 보완하면 승인된다', async () => {
    applyScenario('approval-needs-input')
    expect((await fetchDto<ApprovalDto>('/approvals/ap_01')).payload).toMatchObject({
      task_title: '',
      assignee_member_id: null,
      due_date: null,
    })
    await expect(resolve('ap_01', { status: 'approved' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      status: 400,
      details: { field: 'task_title' },
    })
    expect((await tasks()).total).toBe(10)
    const approved = await resolve('ap_01', {
      status: 'approved',
      task_overrides: {
        task_title: '알림 문구 검토',
        assignee_member_id: 'mb_04',
        due_date: '2026-09-29',
      },
    })
    await expect(fetchDto(`/tasks/${approved.related_task_id}`)).resolves.toMatchObject({
      title: '알림 문구 검토',
      assignee_member_id: 'mb_04',
      due_date: '2026-09-29',
    })
  })

  it('approval-rejected: ap_01 이 반려됐고 태스크는 생기지 않았다', async () => {
    applyScenario('approval-rejected')
    await expect(fetchDto('/approvals/ap_01')).resolves.toMatchObject({
      status: 'rejected',
      related_task_id: null,
      resolved_by: 'mb_01',
    })
    expect((await tasks()).total).toBe(10)
    expect((await extractionItems()).find(({ item_id }) => item_id === 'it_04')).toEqual({
      item_id: 'it_04',
      task_id: null,
      approval_id: 'ap_01',
    })
    await expect(resolve('ap_01', { status: 'approved' })).rejects.toMatchObject({
      code: 'APPROVAL_ALREADY_RESOLVED',
      details: { approval_id: 'ap_01', current_status: 'rejected' },
    })
  })

  it('approval-resolved: ap_02 는 이미 승인돼 태스크 하나로 이어졌고 다시 처리하면 409 다', async () => {
    applyScenario('approval-resolved')
    const approval = await fetchDto<ApprovalDto>('/approvals/ap_02')
    expect(approval).toMatchObject({
      status: 'approved',
      related_task_id: 'tk_90',
      resolved_by: 'mb_01',
    })
    await expect(fetchDto('/tasks/tk_90')).resolves.toMatchObject({
      title: '테스트 계획 정리',
      assignee_member_id: 'mb_02',
      due_date: '2026-09-26',
      version: 1,
      notion_sync_status: 'pending',
    })
    expect((await extractionItems()).find(({ item_id }) => item_id === 'it_05')).toEqual({
      item_id: 'it_05',
      task_id: 'tk_90',
      approval_id: 'ap_02',
    })
    const before = structuredClone(db)
    await expect(resolve('ap_02', { status: 'rejected' })).rejects.toMatchObject({
      code: 'APPROVAL_ALREADY_RESOLVED',
      status: 409,
      details: { approval_id: 'ap_02', current_status: 'approved' },
    })
    expect(db).toEqual(before)
  })

  it('approval-conflict: tk_01 변경 승인이 충돌하고, 확인한 버전으로만 반영된다', async () => {
    applyScenario('approval-conflict')
    await expect(resolve('ap_04', { status: 'approved' })).rejects.toMatchObject({
      code: 'APPROVAL_CONFLICT',
      status: 409,
      details: {
        approval_id: 'ap_04',
        task_id: 'tk_01',
        task_version: 1,
        conflicts: [{ field: 'status', base: 'todo', current: 'in_progress', proposed: 'done' }],
      },
    })
    expect(await resolve('ap_04', { status: 'approved', confirm_task_version: 1 })).toMatchObject({
      status: 'approved',
    })
    await expect(fetchDto('/tasks/tk_01')).resolves.toMatchObject({
      status: 'done',
      progress: 100,
      version: 2,
    })
  })

  it('notion-sync-pending: tk_04 가 반영 대기이고 재시도 대상이 아니다', async () => {
    applyScenario('notion-sync-pending')
    await expect(fetchDto('/tasks/tk_04')).resolves.toMatchObject({ notion_sync_status: 'pending' })
    await expect(retry('tk_04')).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
  })

  it('notion-sync-failed: tk_04 가 반영 실패이고 재시도하면 pending 이 된다', async () => {
    applyScenario('notion-sync-failed')
    await expect(fetchDto('/tasks/tk_04')).resolves.toMatchObject({ notion_sync_status: 'failed' })
    await expect(retry('tk_04')).resolves.toMatchObject({ notion_sync_status: 'pending' })
    await expect(fetchDto('/tasks/tk_04')).resolves.toMatchObject({ notion_sync_status: 'pending' })
  })

  it('tasks-member: 일반 팀원은 조회만 하고 쓰기는 403 이다', async () => {
    applyScenario('tasks-member')
    expect(await role()).toEqual([['ws_01', 'member']])
    expect((await tasks()).total).toBe(10)
    expect((await pending()).total).toBe(3)
    const before = structuredClone(db)
    await expect(
      fetchDto('/tasks/tk_01', jsonRequest('PATCH', { status: 'done' })),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 })
    await expect(resolve('ap_01', { status: 'rejected' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    })
    expect(db).toEqual(before)
  })

  it('M6 시나리오는 Vitest 기본 상태와 다르다 — 기본 상태를 바꾸지 않고 따로 만든다', () => {
    for (const scenario of M6_SCENARIOS.filter((name) => name !== 'tasks-default'))
      expect(createScenarioDb(scenario), scenario).not.toEqual(initialDb())
  })
})
