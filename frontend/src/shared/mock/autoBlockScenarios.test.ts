import { ApiError } from '@/shared/api/errors'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { ListDto } from '@/shared/types/api/envelope'
import type { TaskDto, TaskHistoryDto } from '@/shared/types/api/task'
import { db } from './db'
import { applyScenario } from './scenarios'
import { setMockRole } from './sessions'
import { SILENCE_BLOCKER } from './task-state'

/* #330 무응답 자동 막힘 풀기 handler (계약 §5.7 「자동 막힘 풀기」). 화면 흐름은 app/taskAutoBlock.test.tsx 가 본다 */

const undo = (taskId = 'tk_06') =>
  fetchDto<TaskDto>(`/tasks/${taskId}/auto-block/undo`, { method: 'POST' })
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

it('시나리오의 tk_06 은 스케줄러가 상태와 사유를 바꿔 막았다', async () => {
  const task = await fetchDto<TaskDto>('/tasks/tk_06')
  expect([task.status, task.blocker]).toEqual(['blocked', SILENCE_BLOCKER])
  expect(
    (await history())
      .slice(0, 2)
      .map(({ changed_field, change_source }) => [changed_field, change_source]),
  ).toEqual([
    ['status', 'scheduler'],
    ['blocker', 'scheduler'],
  ])
})

it('풀면 상태와 사유가 막히기 전 값이고 이력 출처는 manual 이다. 두 번째는 409 다', async () => {
  const task = await undo()
  expect([task.status, task.blocker]).toEqual(['in_progress', null])
  const latest = (await history()).filter(({ change_source }) => change_source === 'manual')
  expect(latest.map(({ changed_field }) => changed_field).sort()).toEqual(['blocker', 'status'])

  const error = await failure(undo())
  expect([error.status, error.code]).toEqual([409, 'AUTO_BLOCK_NOT_FOUND'])
})

it('막힌 뒤 사유를 사람이 바꿨으면 409 이고 아무것도 바꾸지 않는다', async () => {
  await fetchDto('/tasks/tk_06', jsonRequest('PATCH', { blocker: '카톡으로 들었어요' }))
  const before = structuredClone(db.tasks.find(({ task_id }) => task_id === 'tk_06'))
  const error = await failure(undo())
  expect([error.status, error.code]).toEqual([409, 'AUTO_BLOCK_NOT_FOUND'])
  expect(db.tasks.find(({ task_id }) => task_id === 'tk_06')).toEqual(before)
})

it('사람이 건 막힘은 자동 막힘이 아니다', async () => {
  expect((await failure(undo('tk_03'))).code).toBe('AUTO_BLOCK_NOT_FOUND')
})

it('PM 이 아니면 403 이다', async () => {
  setMockRole('member')
  expect((await failure(undo())).status).toBe(403)
})
