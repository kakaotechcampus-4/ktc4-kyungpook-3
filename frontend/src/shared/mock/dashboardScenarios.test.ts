import { ApiError } from '@/shared/api/errors'
import { fetchDto, fetchSessionDto } from '@/shared/test/api'
import type { ApprovalDto } from '@/shared/types/api/approval'
import type { ListDto } from '@/shared/types/api/envelope'
import type { ExtractionDto, ExtractionItemRevertDto } from '@/shared/types/api/extraction'
import type { IntegrationsDto } from '@/shared/types/api/integration'
import type { MeetingDto, MeetingSummaryDto } from '@/shared/types/api/meeting'
import type { TaskDto } from '@/shared/types/api/task'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { db, replaceDb, resetDb } from './db'
import { restoreDb, saveDb } from './persistence'
import { MOCK_SCENARIOS, applyScenario, createScenarioDb } from './scenarios'
import type { MockScenario } from './scenarios'
import { setMockRole } from './sessions'

/*
 * M7 — 되돌리기 handler(백엔드 revert_auto_item 재현)와 대시보드 시나리오. 화면 흐름은 app/dashboard.test.tsx 가 본다.
 */

const DASHBOARD_SCENARIOS = [
  'dashboard-default',
  'dashboard-no-meeting',
  'dashboard-notion-not-connected',
  'dashboard-no-auto',
  'dashboard-sync-pending',
  'dashboard-sync-failed',
  'dashboard-revert-rejected',
  'dashboard-member',
  'dashboard-partial-error',
] as const satisfies readonly MockScenario[]

afterEach(() => sessionStorage.clear())

const revert = (itemId: string, extractionId = 'ex_01') =>
  fetchDto<ExtractionItemRevertDto>(`/extractions/${extractionId}/items/${itemId}/revert`, {
    method: 'POST',
  })
const extraction = (id = 'ex_01') => fetchDto<ExtractionDto>(`/extractions/${id}`)
const tasks = () => fetchDto<ListDto<TaskDto>>('/tasks?workspace_id=ws_01')
const pending = () => fetchDto<ListDto<ApprovalDto>>('/approvals?workspace_id=ws_01&status=pending')

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('expected the request to fail')
}

function snapshot() {
  return structuredClone({ tasks: db.tasks, approvals: db.approvals, extractions: db.extractions })
}

describe('추출 조회 — reverted_at·approval_status', () => {
  it('항목마다 되돌림 시각과 지금 승인 상태가 온다', async () => {
    const { items } = await extraction()
    expect(
      items.map(({ item_id, reverted_at, approval_status }) => [
        item_id,
        reverted_at,
        approval_status,
      ]),
    ).toEqual([
      ['it_01', null, null],
      ['it_02', null, null],
      ['it_03', null, null],
      ['it_04', null, 'pending'],
      ['it_05', null, 'pending'],
      ['it_06', null, 'pending'],
    ])
  })

  it('승인 상태는 저장값이 아니라 지금 승인을 따른다 — 반려 뒤 rejected', async () => {
    db.approvals[0].status = 'rejected'
    const { items } = await extraction()
    expect(items[3]).toMatchObject({ approval_id: 'ap_01', approval_status: 'rejected' })
  })
})

describe('되돌리기 handler', () => {
  it('성공하면 태스크를 지우고 같은 내용의 생성 승인을 만들고, 항목 연결을 바꾼다', async () => {
    const created = await revert('it_02')
    expect(created).toEqual({
      item_id: 'it_02',
      reverted_task_id: 'tk_02',
      approval_id: 'ap_90',
      reverted_at: expect.any(String) as string,
    })
    expect((await tasks()).items.map(({ task_id }) => task_id)).not.toContain('tk_02')
    await expect(failure(fetchDto('/tasks/tk_02'))).resolves.toMatchObject({
      code: 'TASK_NOT_FOUND',
    })
    const approval = (await pending()).items.find(({ approval_id }) => approval_id === 'ap_90')
    expect(approval).toMatchObject({
      type: 'task_create',
      status: 'pending',
      related_task_id: null,
      payload: {
        task_title: '회원가입 화면',
        assignee_member_id: 'mb_02',
        due_date: '2026-09-16',
        extraction_item_id: 'it_02',
        meeting_id: 'mt_09',
        gate: 'review',
        reverted_task_id: 'tk_02',
      },
    })
    const item = (await extraction()).items.find(({ item_id }) => item_id === 'it_02')
    expect(item).toMatchObject({
      gate: 'auto',
      task_id: null,
      approval_id: 'ap_90',
      approval_status: 'pending',
      reverted_at: created.reverted_at,
    })
  })

  it('새 승인을 승인하면 그 항목에 새 태스크가 이어지고 되돌림 시각은 남는다', async () => {
    await revert('it_02')
    await fetchDto(`/approvals/ap_90`, { method: 'PATCH', body: { status: 'approved' } })
    const item = (await extraction()).items.find(({ item_id }) => item_id === 'it_02')
    expect(item).toMatchObject({ approval_status: 'approved', task_id: 'tk_90' })
    expect(item?.reverted_at).not.toBeNull()
  })

  type Rejection = [string, () => unknown, string, Record<string, unknown>]
  it.each<Rejection>([
    ['already_reverted', () => revert('it_03'), 'it_03', {}],
    ['not_auto_created', () => undefined, 'it_05', {}],
    [
      'task_missing',
      () => {
        db.tasks = db.tasks.filter(({ task_id }) => task_id !== 'tk_01')
      },
      'it_01',
      { task_id: 'tk_01' },
    ],
    [
      'task_changed',
      () => fetchDto('/tasks/tk_01', { method: 'PATCH', body: { status: 'done' } }),
      'it_01',
      { task_id: 'tk_01', task_version: 2 },
    ],
    [
      'pending_approval',
      () => {
        replaceDb(createScenarioDb('dashboard-revert-rejected'))
      },
      'it_02',
      { task_id: 'tk_02', approval_id: 'ap_05' },
    ],
  ])('%s 이면 409 이고 아무것도 바꾸지 않는다', async (reason, arrange, itemId, extra) => {
    await arrange()
    const before = snapshot()
    const error = await failure(revert(itemId))
    expect(error).toMatchObject({
      status: 409,
      code: 'AUTO_TASK_NOT_REVERTIBLE',
      details: { item_id: itemId, reason, ...extra },
    })
    expect(snapshot()).toEqual(before)
  })

  it('일반 팀원은 403 이고 아무것도 바꾸지 않는다', async () => {
    setMockRole('member')
    const before = snapshot()
    await expect(failure(revert('it_01'))).resolves.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    })
    expect(snapshot()).toEqual(before)
  })

  it('없는 추출·항목은 404 다', async () => {
    await expect(failure(revert('it_01', 'ex_99'))).resolves.toMatchObject({
      status: 404,
      code: 'EXTRACTION_NOT_FOUND',
    })
    await expect(failure(revert('it_99'))).resolves.toMatchObject({
      status: 404,
      code: 'EXTRACTION_ITEM_NOT_FOUND',
    })
  })

  it('로그인하지 않았으면 401 이다', async () => {
    db.authenticated = false
    await expect(failure(revert('it_01'))).resolves.toMatchObject({ status: 401 })
  })
})

describe('M7 대시보드 시나리오', () => {
  it('모두 등록돼 있고 ws_01 하나에 로그인한다', async () => {
    for (const scenario of DASHBOARD_SCENARIOS) {
      expect(MOCK_SCENARIOS).toContain(scenario)
      applyScenario(scenario)
      await expect(fetchSessionDto()).resolves.toMatchObject({
        workspace_count: 1,
        last_workspace_id: 'ws_01',
      })
      const { items } = await fetchDto<ListDto<WorkspaceDto>>('/workspaces')
      expect(items.map(({ workspace_id, role }) => [workspace_id, role])).toEqual([
        ['ws_01', scenario === 'dashboard-member' ? 'member' : 'pm'],
      ])
    }
  })

  const doneMeetings = async () =>
    (await fetchDto<ListDto<MeetingSummaryDto>>('/workspaces/ws_01/meetings')).items
      .filter(({ status }) => status === 'done')
      .map(({ meeting_id }) => meeting_id)
  const syncOf = async () =>
    Object.fromEntries(
      (await tasks()).items
        .filter(({ task_id }) => ['tk_01', 'tk_02', 'tk_03'].includes(task_id))
        .map(({ task_id, notion_sync_status }) => [task_id, notion_sync_status]),
    )

  it('기본: 최근 반영 세 태스크가 모두 반영 완료다', async () => {
    applyScenario('dashboard-default')
    expect(await syncOf()).toEqual({ tk_01: 'synced', tk_02: 'synced', tk_03: 'synced' })
    expect(await doneMeetings()).toEqual(['mt_09', 'mt_07'])
  })

  it('회의 없음: 정리 끝난 회의가 없다', async () => {
    applyScenario('dashboard-no-meeting')
    expect(await doneMeetings()).toEqual([])
  })

  it('Notion 미연결', async () => {
    applyScenario('dashboard-notion-not-connected')
    const { notion } = await fetchDto<IntegrationsDto>('/workspaces/ws_01/integrations')
    expect(notion.status).toBe('not_connected')
  })

  it('자동 처리 없음: 최신 완료 회의(mt_07)의 추출에 항목이 없다', async () => {
    applyScenario('dashboard-no-auto')
    expect(await doneMeetings()).toEqual(['mt_07'])
    const meeting = await fetchDto<MeetingDto>('/meetings/mt_07')
    expect((await extraction(meeting.extraction_id!)).items).toEqual([])
  })

  it('반영 대기·실패', async () => {
    applyScenario('dashboard-sync-pending')
    expect((await syncOf()).tk_02).toBe('pending')
    applyScenario('dashboard-sync-failed')
    expect((await syncOf()).tk_02).toBe('failed')
  })

  it('되돌림 거부: tk_01 은 task_changed, tk_02 는 pending_approval, tk_03 은 되돌릴 수 있다', async () => {
    applyScenario('dashboard-revert-rejected')
    await expect(failure(revert('it_01'))).resolves.toMatchObject({
      details: { reason: 'task_changed' },
    })
    await expect(failure(revert('it_02'))).resolves.toMatchObject({
      details: { reason: 'pending_approval', approval_id: 'ap_05' },
    })
    await expect(revert('it_03')).resolves.toMatchObject({ reverted_task_id: 'tk_03' })
  })

  it('일반 팀원: 되돌리기가 403 이다', async () => {
    applyScenario('dashboard-member')
    await expect(failure(revert('it_01'))).resolves.toMatchObject({ status: 403 })
  })

  it('부분 조회 실패: 최신 완료 회의의 추출만 404 다', async () => {
    applyScenario('dashboard-partial-error')
    const meeting = await fetchDto<MeetingDto>('/meetings/mt_09')
    await expect(failure(extraction(meeting.extraction_id!))).resolves.toMatchObject({
      status: 404,
      code: 'EXTRACTION_NOT_FOUND',
    })
    expect((await tasks()).items).toHaveLength(10)
  })

  it.each(DASHBOARD_SCENARIOS)(
    '%s 는 저장 버전 그대로 sessionStorage 에서 복원된다',
    (scenario) => {
      replaceDb(createScenarioDb(scenario))
      saveDb(sessionStorage)
      resetDb()
      expect(restoreDb(sessionStorage)).toBe(true)
      expect(db).toEqual(createScenarioDb(scenario))
    },
  )
})
