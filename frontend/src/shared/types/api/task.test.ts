import { db } from '@/shared/mock/db'
import { taskFixtures, taskHistoryFixtures } from '@/shared/mock/fixtures/task'
import { applyScenario } from '@/shared/mock/scenarios'
import { toTaskResponse } from '@/shared/mock/task-state'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import { timelineListSchema } from './reply'
import { taskHistoryListSchema, taskHistorySchema, taskListSchema, taskSchema } from './task'

const valid = toTaskResponse(taskFixtures[0])

describe('태스크 스키마', () => {
  it('서버가 덧붙인 모르는 필드는 버리고 읽는다', () => {
    expect(taskSchema.parse({ ...valid, total_minutes: 3 })).toEqual(valid)
  })

  it('start_date 가 빠진 옛 응답도 읽는다', () => {
    const legacy: Partial<typeof valid> = { ...valid }
    delete legacy.start_date
    expect(taskSchema.safeParse(legacy).success).toBe(true)
  })

  it.each([
    ['모르는 상태', { status: 'archived' }],
    ['소수 버전', { version: 1.5 }],
    ['문자열 버전', { version: '3' }],
    ['null 버전', { version: null }],
    ['필수 필드 누락', { created_at: undefined }],
  ])('%s 는 읽지 않는다', (_, patch) => {
    expect(taskSchema.safeParse({ ...valid, ...patch }).success).toBe(false)
  })

  it.each([
    ['문자열', 'true'],
    ['숫자', 1],
    ['null', null],
    ['없음', undefined],
  ])('자동 막힘이 %s 이면 거절하지 않고 풀 수 없는 것(false)으로 읽는다', (_, autoBlocked) => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(taskSchema.parse({ ...valid, auto_blocked: autoBlocked }).auto_blocked).toBe(false)
      expect(warning).toHaveBeenCalledTimes(1)
    } finally {
      warning.mockRestore()
    }
  })

  it('이력의 모르는 필드·출처는 스키마가 거절하지 않는다. 화면이 알 수 없는 값으로 읽는다', () => {
    expect(
      taskHistorySchema.safeParse({
        ...taskHistoryFixtures[0],
        changed_field: 'priority',
        change_source: 'slack',
      }).success,
    ).toBe(true)
  })
})

describe('MSW 픽스처가 같은 스키마를 따른다', () => {
  it('태스크·이력 픽스처', () => {
    for (const task of taskFixtures) expect(taskSchema.parse(toTaskResponse(task))).toBeDefined()
    for (const entry of taskHistoryFixtures) expect(taskHistorySchema.parse(entry)).toBeDefined()
  })

  it.each([
    ['기본', null],
    ['답장 판단', 'reply-judgment'],
  ] as const)('%s 상태에서 handler 가 내는 목록·상세·이력·기록', async (_, scenario) => {
    if (scenario !== null) applyScenario(scenario)
    const list = taskListSchema.parse(
      await fetchDto('/tasks', { params: { workspace_id: 'ws_01' } }),
    )
    expect(list.items.length).toBe(db.tasks.filter((task) => task.workspace_id === 'ws_01').length)
    for (const { task_id } of list.items) {
      taskSchema.parse(await fetchDto(`/tasks/${task_id}`))
      taskHistoryListSchema.parse(await fetchDto(`/tasks/${task_id}/history`))
      timelineListSchema.parse(await fetchDto(`/tasks/${task_id}/timeline`))
    }
  })

  it('handler 가 변경·생성에 돌려주는 태스크', async () => {
    taskSchema.parse(await fetchDto('/tasks/tk_01', jsonRequest('PATCH', { status: 'done' })))
    taskSchema.parse(
      await fetchDto('/tasks', jsonRequest('POST', { workspace_id: 'ws_01', title: '새 일' })),
    )
  })
})
