import { ApiError } from '@/shared/api/errors'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { ListDto } from '@/shared/types/api/envelope'
import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'
import { db } from './db'
import { applyScenario } from './scenarios'
import { setMockRole } from './sessions'
import { SILENCE_BLOCKER, blockBySilence } from './task-state'

const undo = (taskId = 'tk_06') =>
  fetchDto<TaskDto>(`/tasks/${taskId}/auto-block/undo`, { method: 'POST' })
const get = (taskId = 'tk_06') => fetchDto<TaskDto>(`/tasks/${taskId}`)
const patch = (body: Record<string, unknown>, taskId = 'tk_06') =>
  fetchDto<TaskDto>(`/tasks/${taskId}`, jsonRequest('PATCH', body))
const history = async (taskId = 'tk_06') =>
  (await fetchDto<ListDto<TaskHistoryDto>>(`/tasks/${taskId}/history`)).items

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('요청이 성공했다')
}

beforeEach(() => applyScenario('notifications-default'))

it('시나리오의 tk_06 은 스케줄러가 상태와 사유를 바꿔 막았고 풀 수 있다', async () => {
  const task = await get()
  expect([task.status, task.blocker, task.auto_blocked]).toEqual(['blocked', SILENCE_BLOCKER, true])
  expect(
    (await history())
      .slice(0, 2)
      .map(({ changed_field, change_source }) => [changed_field, change_source]),
  ).toEqual([
    ['status', 'scheduler'],
    ['blocker', 'scheduler'],
  ])
})

it('풀면 상태와 사유가 막히기 전 값이고 auto_blocked 는 false 다. 이력 출처는 manual 이고 두 번째는 409 다', async () => {
  const task = await undo()
  expect([task.status, task.blocker, task.auto_blocked]).toEqual(['in_progress', null, false])
  expect((await get()).auto_blocked).toBe(false)
  const latest = (await history()).filter(({ change_source }) => change_source === 'manual')
  expect(latest.map(({ changed_field }) => changed_field).sort()).toEqual(['blocker', 'status'])

  const error = await failure(undo())
  expect([error.status, error.code]).toEqual([409, 'AUTO_BLOCK_NOT_FOUND'])
})

it('막힌 뒤 사유만 사람이 바꿨으면 이력은 스케줄러 막힘이어도 auto_blocked 는 false 이고 풀기는 409 다', async () => {
  expect((await patch({ blocker: '카톡으로 들었어요' })).auto_blocked).toBe(false)
  const lastStatus = (await history()).find(({ changed_field }) => changed_field === 'status')
  expect(lastStatus?.change_source).toBe('scheduler')
  const before = structuredClone(db.tasks.find(({ task_id }) => task_id === 'tk_06'))

  const error = await failure(undo())
  expect([error.status, error.code]).toEqual([409, 'AUTO_BLOCK_NOT_FOUND'])
  expect(db.tasks.find(({ task_id }) => task_id === 'tk_06')).toEqual(before)
})

it('막힌 뒤 사람이 진행 중으로 바꿨다가 다시 막으면 이력은 사람 변경이어도 auto_blocked 는 true 이고 막히기 전 값으로 풀린다', async () => {
  expect((await patch({ status: 'in_progress' })).auto_blocked).toBe(false)
  const reblocked = await patch({ status: 'blocked' })
  expect([reblocked.blocker, reblocked.auto_blocked]).toEqual([SILENCE_BLOCKER, true])
  const lastStatus = (await history()).find(({ changed_field }) => changed_field === 'status')
  expect(lastStatus?.change_source).toBe('manual')

  const task = await undo()
  expect([task.status, task.blocker, task.auto_blocked]).toEqual(['in_progress', null, false])
})

it('이미 막힌 태스크는 무응답이어도 바꾸지 않고 풀 수 없다', async () => {
  const task = db.tasks.find(({ task_id }) => task_id === 'tk_03')!
  const before = structuredClone(task)
  blockBySilence(task, '2026-09-18T08:30:00+09:00')
  expect(task).toEqual(before)
  expect((await get('tk_03')).auto_blocked).toBe(false)
  expect((await failure(undo('tk_03'))).code).toBe('AUTO_BLOCK_NOT_FOUND')
})

it('사람이 건 막힘은 사유가 스케줄러 문구여도 auto_blocked 가 false 이고 풀 수 없다', async () => {
  const blocked = await patch({ blocker: SILENCE_BLOCKER }, 'tk_03')
  expect([blocked.status, blocked.auto_blocked]).toEqual(['blocked', false])
  expect((await failure(undo('tk_03'))).code).toBe('AUTO_BLOCK_NOT_FOUND')
})

it('PM 이 아니면 풀기는 403 이지만 auto_blocked 는 PM 과 같은 값을 받는다', async () => {
  setMockRole('member')
  expect((await get()).auto_blocked).toBe(true)
  expect((await failure(undo())).status).toBe(403)
})

describe('TaskResponse 를 돌려주는 경로는 모두 auto_blocked 를 싣는다', () => {
  it('GET /tasks 는 풀 수 있는 태스크만 true 다', async () => {
    const { items } = await fetchDto<ListDto<TaskDto>>('/tasks?workspace_id=ws_01')
    expect(items.every(({ auto_blocked }) => typeof auto_blocked === 'boolean')).toBe(true)
    expect(items.filter(({ auto_blocked }) => auto_blocked).map(({ task_id }) => task_id)).toEqual([
      'tk_06',
    ])
  })

  it('POST /tasks 는 false 다', async () => {
    const created = await fetchDto<TaskDto>(
      '/tasks',
      jsonRequest('POST', { workspace_id: 'ws_01', title: '새 태스크', status: 'blocked' }),
    )
    expect(created.auto_blocked).toBe(false)
  })

  it('이력 되돌리기는 되돌린 뒤의 값으로 판정한다 — 고친 사유를 되돌리면 다시 풀 수 있다', async () => {
    await patch({ blocker: '카톡으로 들었어요' })
    const edit = (await history()).find(
      ({ changed_field, new_value }) =>
        changed_field === 'blocker' && new_value === '카톡으로 들었어요',
    )!
    const rolledBack = await fetchDto<TaskDto>(`/tasks/tk_06/history/${edit.history_id}/rollback`, {
      method: 'POST',
    })
    expect([rolledBack.blocker, rolledBack.auto_blocked]).toEqual([SILENCE_BLOCKER, true])
  })

  it('Notion 반영 재시도도 싣는다', async () => {
    db.tasks.find(({ task_id }) => task_id === 'tk_06')!.notion_sync_status = 'failed'
    const retried = await fetchDto<TaskDto>('/tasks/tk_06/notion-sync/retry', { method: 'POST' })
    expect([retried.notion_sync_status, retried.auto_blocked]).toEqual(['pending', true])
  })
})
