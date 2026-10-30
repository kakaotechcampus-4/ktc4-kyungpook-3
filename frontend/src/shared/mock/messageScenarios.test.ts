import { ApiError } from '@/shared/api/errors'
import { fetchDto } from '@/shared/test/api'
import type { MessageInboxDto, MessageThreadDto } from '@/shared/types/api/message'
import { db, replaceDb, resetDb } from './db'
import { restoreDb, saveDb } from './persistence'
import { applyScenario, createScenarioDb } from './scenarios'
import type { MockScenario } from './scenarios'

/*
 * M8 메시지의 임시 handler 와 시나리오 (계획 C-7). 경로·모양은 계약이 아니다. 화면 흐름은 app/messagesMsw.test.tsx 가 본다.
 */

const MESSAGE_SCENARIOS = [
  'messages-default',
  'messages-empty',
  'messages-list-error',
  'messages-thread-error',
] as const satisfies readonly MockScenario[]

afterEach(() => sessionStorage.clear())

const inbox = (workspaceId = 'ws_01') =>
  fetchDto<MessageInboxDto>(`/workspaces/${workspaceId}/messages`)
const thread = (threadId: string, workspaceId = 'ws_01') =>
  fetchDto<MessageThreadDto>(`/workspaces/${workspaceId}/messages/threads/${threadId}`)

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('expected the request to fail')
}

describe('메시지 handler', () => {
  it('목록은 그 공간의 검토 항목과 대화 요약이다 — 사람별 대화가 최근 순으로 먼저, 채널이 뒤다', async () => {
    const { reviews, threads } = await inbox()
    expect(reviews.map(({ review_id }) => review_id)).toEqual(['rv_01', 'rv_02'])
    expect(threads.map(({ thread_id, kind }) => [thread_id, kind])).toEqual([
      ['th_01', 'direct'],
      ['th_02', 'direct'],
      ['th_03', 'direct'],
      ['th_04', 'direct'],
      ['th_05', 'channel'],
    ])
    expect(threads[0].last_message?.message_id).toBe('mg_03')
    expect(JSON.stringify({ reviews, threads })).not.toContain('workspace_id')
  })

  it('공간마다 따로다 — ws_02 에는 ws_01 의 항목이 없다', async () => {
    const { reviews, threads } = await inbox('ws_02')
    expect(reviews).toEqual([])
    expect(threads.map(({ thread_id }) => thread_id)).toEqual(['th_11'])
  })

  it('대화는 메시지를 모두 싣는다. 다른 공간의 대화나 없는 대화는 404 다', async () => {
    const detail = await thread('th_01')
    expect(detail).toMatchObject({ thread_id: 'th_01', kind: 'direct', name: '이재환' })
    expect(detail.messages.map(({ sender }) => sender)).toEqual(['bot', 'counterpart', 'bot'])
    expect((await failure(thread('th_11'))).status).toBe(404)
    expect((await failure(thread('th_99'))).status).toBe(404)
  })

  it('소속이 아닌 공간은 403 이다', async () => {
    expect((await failure(inbox('ws_09'))).status).toBe(403)
  })

  it('조회는 db 를 바꾸지 않는다', async () => {
    const before = structuredClone({ reviews: db.messageReviews, threads: db.messageThreads })
    await inbox()
    await thread('th_01')
    expect({ reviews: db.messageReviews, threads: db.messageThreads }).toEqual(before)
  })
})

describe('메시지 시나리오', () => {
  it('messages-empty: ws_01 의 검토·대화가 모두 없다', async () => {
    applyScenario('messages-empty')
    expect(await inbox()).toEqual({ reviews: [], threads: [] })
  })

  it('messages-list-error: 목록만 5xx 이고 대화는 받는다', async () => {
    applyScenario('messages-list-error')
    expect((await failure(inbox())).status).toBe(500)
    expect((await thread('th_01')).thread_id).toBe('th_01')
  })

  it('messages-thread-error: 목록은 받고 th_01 만 5xx 다', async () => {
    applyScenario('messages-thread-error')
    expect((await inbox()).threads).toHaveLength(5)
    expect((await failure(thread('th_01'))).status).toBe(500)
    expect((await thread('th_02')).thread_id).toBe('th_02')
  })

  it.each(MESSAGE_SCENARIOS)('%s 는 sessionStorage 에서 그대로 복원된다', (scenario) => {
    replaceDb(createScenarioDb(scenario))
    saveDb(sessionStorage)
    resetDb()
    expect(restoreDb(sessionStorage)).toBe(true)
    expect(db).toEqual(createScenarioDb(scenario))
  })
})
