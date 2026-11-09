import type { MockInstance } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { http } from 'msw'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { taskFixtures } from '@/shared/mock/fixtures/task'
import { server } from '@/shared/mock/server'
import { toTaskResponse } from '@/shared/mock/task-state'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import {
  retryTaskNotionSync,
  taskDetailQueryOptions,
  taskHistoryQueryOptions,
  taskKeys,
  taskListQueryOptions,
  updateTaskStatus,
} from './taskApi'

const otherWorkspaceTask = { ...toTaskResponse(taskFixtures[0]), workspace_id: 'ws_02' }

describe('query key', () => {
  it('목록·상세·이력 key 는 workspaceId 를 두 번째 칸에 두고 태스크 접두어를 함께 쓴다', () => {
    expect(taskKeys('ws_01')).toEqual(['workspace', 'ws_01', 'tasks'])
    expect(taskListQueryOptions('ws_01').queryKey).toEqual(['workspace', 'ws_01', 'tasks', 'list'])
    expect(taskDetailQueryOptions('ws_01', 'tk_01').queryKey).toEqual([
      'workspace',
      'ws_01',
      'tasks',
      'detail',
      'tk_01',
    ])
    expect(taskHistoryQueryOptions('ws_01', 'tk_01').queryKey).toEqual([
      'workspace',
      'ws_01',
      'tasks',
      'history',
      'tk_01',
    ])
  })

  it('공간이 다르면 같은 태스크라도 key 가 다르다', () => {
    expect(taskDetailQueryOptions('ws_02', 'tk_01').queryKey).not.toEqual(
      taskDetailQueryOptions('ws_01', 'tk_01').queryKey,
    )
  })
})

describe('조회', () => {
  it('목록을 공간 조건으로 받아 버전·Notion 상태가 있는 Task 로 바꾼다', async () => {
    const requests = recordRequests()
    const tasks = await new QueryClient().fetchQuery(taskListQueryOptions('ws_01'))
    expect(requests.started).toEqual([{ method: 'GET', path: '/tasks?workspace_id=ws_01' }])
    expect(tasks).toHaveLength(10)
    expect(tasks.find(({ id }) => id === 'tk_01')).toMatchObject({
      workspaceId: 'ws_01',
      version: 1,
      notionSyncStatus: 'synced',
    })
  })

  it('목록에 다른 공간의 태스크가 섞이면 성공 결과로 캐시하지 않는다', async () => {
    server.use(http.get('/api/v1/tasks', () => ok({ items: [otherWorkspaceTask], total: 1 })))
    const client = new QueryClient()
    await expect(client.fetchQuery(taskListQueryOptions('ws_01'))).rejects.toMatchObject({
      code: 'WORKSPACE_MISMATCH',
      kind: 'invalid_response',
    })
    expect(client.getQueryData(taskListQueryOptions('ws_01').queryKey)).toBeUndefined()
  })

  it('상세는 응답 공간이 요청과 같을 때만 성공이다', async () => {
    const client = new QueryClient()
    await expect(
      client.fetchQuery(taskDetailQueryOptions('ws_01', 'tk_01')),
    ).resolves.toMatchObject({ id: 'tk_01', workspaceId: 'ws_01', version: 1 })
  })

  it('상세 응답의 workspace_id 가 요청과 다르면 성공 데이터로 캐시에 넣지 않는다', async () => {
    server.use(http.get('/api/v1/tasks/:taskId', () => ok(otherWorkspaceTask)))
    const client = new QueryClient()
    await expect(client.fetchQuery(taskDetailQueryOptions('ws_01', 'tk_01'))).rejects.toMatchObject(
      {
        code: 'WORKSPACE_MISMATCH',
        kind: 'invalid_response',
        details: { requested_workspace_id: 'ws_01', response_workspace_id: 'ws_02' },
      },
    )
    expect(client.getQueryData(taskDetailQueryOptions('ws_01', 'tk_01').queryKey)).toBeUndefined()
  })

  it('이력은 상세로 공간을 확인한 뒤 최신순 이력을 돌려준다', async () => {
    const history = await new QueryClient().fetchQuery(taskHistoryQueryOptions('ws_01', 'tk_01'))
    expect(history.map((item) => (item.kind === 'history' ? item.entry.id : item.id))).toEqual([
      'hs_02',
      'hs_01',
    ])
  })

  it('상세가 캐시에 있으면 이력 조회가 상세를 다시 요청하지 않는다', async () => {
    const client = new QueryClient()
    await client.fetchQuery(taskDetailQueryOptions('ws_01', 'tk_01'))
    const requests = recordRequests()
    await client.fetchQuery(taskHistoryQueryOptions('ws_01', 'tk_01'))
    expect(requests.started).toEqual([
      { method: 'GET', path: '/tasks/tk_01/history' },
      { method: 'GET', path: '/tasks/tk_01/timeline' },
    ])
  })

  it('이력 대상 태스크가 다른 공간이면 이력을 성공 결과로 캐시하지 않는다', async () => {
    server.use(http.get('/api/v1/tasks/:taskId', () => ok(otherWorkspaceTask)))
    const client = new QueryClient()
    await expect(
      client.fetchQuery(taskHistoryQueryOptions('ws_01', 'tk_01')),
    ).rejects.toMatchObject({ code: 'WORKSPACE_MISMATCH' })
    expect(client.getQueryData(taskHistoryQueryOptions('ws_01', 'tk_01').queryKey)).toBeUndefined()
    expect(client.getQueryData(taskDetailQueryOptions('ws_01', 'tk_01').queryKey)).toBeUndefined()
  })

  it('이력에 다른 태스크의 항목이 섞이면 잘못된 응답이다', async () => {
    const foreign = { ...db.taskHistory[0], task_id: 'tk_02' }
    server.use(http.get('/api/v1/tasks/:taskId/history', () => ok({ items: [foreign], total: 1 })))
    const client = new QueryClient()
    await expect(
      client.fetchQuery(taskHistoryQueryOptions('ws_01', 'tk_01')),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(client.getQueryData(taskHistoryQueryOptions('ws_01', 'tk_01').queryKey)).toBeUndefined()
  })
})

describe('응답 검증 (#348)', () => {
  const served = () => db.tasks.map((task) => toTaskResponse(task))
  let warning: MockInstance<typeof console.warn>
  beforeEach(() => {
    warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warning.mockRestore())

  it('상세의 모르는 상태는 할 일로 바꾸지 않고 잘못된 응답이다. 캐시에 넣지 않고 다시 요청하지 않는다', async () => {
    server.use(http.get('/api/v1/tasks/:taskId', () => ok({ ...served()[0], status: 'archived' })))
    const requests = recordRequests()
    const client = new QueryClient()
    await expect(client.fetchQuery(taskDetailQueryOptions('ws_01', 'tk_01'))).rejects.toMatchObject(
      {
        code: 'INVALID_RESPONSE',
        kind: 'invalid_response',
        details: { entity: 'task', path: 'status' },
      },
    )
    expect(client.getQueryData(taskDetailQueryOptions('ws_01', 'tk_01').queryKey)).toBeUndefined()
    expect(requests.started).toHaveLength(1)
    expect(warning).toHaveBeenCalledWith('Invalid task response', [
      expect.objectContaining({ path: 'status', value: 'archived' }),
    ])
  })

  it('필수 필드가 빠진 상세는 그 필드 경로로 잘못된 응답이다', async () => {
    const partial: Partial<ReturnType<typeof served>[number]> = { ...served()[0] }
    delete partial.created_at
    server.use(http.get('/api/v1/tasks/:taskId', () => ok(partial)))
    await expect(
      new QueryClient().fetchQuery(taskDetailQueryOptions('ws_01', 'tk_01')),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', details: { path: 'created_at' } })
  })

  it('목록은 한 건만 깨져도 전체가 실패한다. 깨진 건을 빼고 보여 주지 않는다', async () => {
    const items = served()
    items[3] = { ...items[3], version: 2.5 }
    server.use(http.get('/api/v1/tasks', () => ok({ items, total: items.length })))
    const client = new QueryClient()
    await expect(client.fetchQuery(taskListQueryOptions('ws_01'))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      details: { entity: 'task', path: 'items[3].version' },
    })
    expect(client.getQueryData(taskListQueryOptions('ws_01').queryKey)).toBeUndefined()
  })

  it('상태를 바꾼 응답의 모르는 상태도 잘못된 응답이다', async () => {
    server.use(
      http.patch('/api/v1/tasks/:taskId', () => ok({ ...served()[0], status: 'archived' })),
    )
    await expect(updateTaskStatus('ws_01', 'tk_01', 'done')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      details: { entity: 'task', path: 'status' },
    })
  })

  it('이력의 모르는 필드·출처는 이력을 실패시키지 않고 모르는 값으로 남는다', async () => {
    const entry = { ...db.taskHistory[0], changed_field: 'priority', change_source: 'slack' }
    server.use(
      http.get('/api/v1/tasks/:taskId/history', () => ok({ items: [entry], total: 1 })),
      http.get('/api/v1/tasks/:taskId/timeline', () => ok({ items: [], total: 0 })),
    )
    await expect(
      new QueryClient().fetchQuery(taskHistoryQueryOptions('ws_01', 'tk_01')),
    ).resolves.toEqual([])
    server.use(
      http.get('/api/v1/tasks/:taskId/timeline', () =>
        ok({
          items: [
            {
              kind: 'history',
              at: entry.created_at,
              history_id: entry.history_id,
              changed_field: entry.changed_field,
              old_value: entry.old_value,
              new_value: entry.new_value,
              change_source: entry.change_source,
            },
          ],
          total: 1,
        }),
      ),
    )
    const [item] = await new QueryClient().fetchQuery(taskHistoryQueryOptions('ws_01', 'tk_01'))
    expect(item).toMatchObject({
      kind: 'history',
      entry: { field: { unknown: 'priority' }, source: { unknown: 'slack' } },
    })
  })

  it('기록의 모르는 칸 종류는 그릴 수 없어 잘못된 응답이다', async () => {
    server.use(
      http.get('/api/v1/tasks/:taskId/timeline', () =>
        ok({ items: [{ kind: 'poll', at: '2026-09-17T01:00:00Z' }], total: 1 }),
      ),
    )
    await expect(
      new QueryClient().fetchQuery(taskHistoryQueryOptions('ws_01', 'tk_01')),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      details: { entity: 'task timeline', path: 'items[0].kind' },
    })
  })

  it('다른 태스크의 이력이 섞이면 그 이력의 경로로 잘못된 응답이다', async () => {
    const foreign = { ...db.taskHistory[0], task_id: 'tk_02' }
    server.use(
      http.get('/api/v1/tasks/:taskId/history', () =>
        ok({ items: [db.taskHistory[0], foreign], total: 2 }),
      ),
    )
    await expect(
      new QueryClient().fetchQuery(taskHistoryQueryOptions('ws_01', 'tk_01')),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      details: { entity: 'task history', path: 'items[1].task_id' },
    })
  })
})

describe('상태 변경', () => {
  it('본문은 상태 하나다. 변경자 ID 를 보내지 않는다', async () => {
    const bodies = recordRequestBodies('PATCH', '/tasks/tk_01')
    const task = await updateTaskStatus('ws_01', 'tk_01', 'done')
    expect(task).toMatchObject({ id: 'tk_01', status: 'done' })
    await vi.waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ status: 'done' })
    expect(bodies[0]).not.toHaveProperty('changed_by')
  })

  it('돌아온 태스크가 다른 공간이면 던진다', async () => {
    server.use(http.patch('/api/v1/tasks/:taskId', () => ok(otherWorkspaceTask)))
    await expect(updateTaskStatus('ws_01', 'tk_01', 'done')).rejects.toMatchObject({
      code: 'WORKSPACE_MISMATCH',
    })
  })
})

describe('Notion 재시도', () => {
  it('본문 없이 POST 하고 돌아온 상태(pending)를 그대로 읽는다', async () => {
    const received: { method: string; body: string }[] = []
    server.use(
      http.post('/api/v1/tasks/:taskId/notion-sync/retry', async ({ request, params }) => {
        received.push({ method: request.method, body: await request.text() })
        return ok({
          ...toTaskResponse(taskFixtures[0]),
          task_id: params.taskId,
          notion_sync_status: 'pending',
        })
      }),
    )
    const task = await retryTaskNotionSync('ws_01', 'tk_01')
    expect(received).toEqual([{ method: 'POST', body: '' }])
    expect(task).toMatchObject({ id: 'tk_01', notionSyncStatus: 'pending' })
  })

  it('돌아온 태스크가 다른 공간이면 던진다', async () => {
    server.use(http.post('/api/v1/tasks/:taskId/notion-sync/retry', () => ok(otherWorkspaceTask)))
    await expect(retryTaskNotionSync('ws_01', 'tk_01')).rejects.toMatchObject({
      code: 'WORKSPACE_MISMATCH',
    })
  })
})
