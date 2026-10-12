import { QueryClient } from '@tanstack/react-query'
import { http } from 'msw'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { taskFixtures } from '@/shared/mock/fixtures/task'
import { server } from '@/shared/mock/server'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import {
  retryTaskNotionSync,
  taskDetailQueryOptions,
  taskHistoryQueryOptions,
  taskKeys,
  taskListQueryOptions,
  updateTaskStatus,
} from './taskApi'

const otherWorkspaceTask = { ...taskFixtures[0], workspace_id: 'ws_02' }

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
    expect(history.map(({ id }) => id)).toEqual(['hs_02', 'hs_01'])
  })

  it('상세가 캐시에 있으면 이력 조회가 상세를 다시 요청하지 않는다', async () => {
    const client = new QueryClient()
    await client.fetchQuery(taskDetailQueryOptions('ws_01', 'tk_01'))
    const requests = recordRequests()
    await client.fetchQuery(taskHistoryQueryOptions('ws_01', 'tk_01'))
    expect(requests.started).toEqual([{ method: 'GET', path: '/tasks/tk_01/history' }])
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
        return ok({ ...taskFixtures[0], task_id: params.taskId, notion_sync_status: 'pending' })
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
