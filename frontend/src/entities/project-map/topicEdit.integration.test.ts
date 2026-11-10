import { QueryClient } from '@tanstack/react-query'
import { http } from 'msw'
import { ok } from '@/shared/mock/envelope'
import { normalizeTopicName } from '@/shared/mock/handlers/projectMap'
import { server } from '@/shared/mock/server'
import { fetchDto } from '@/shared/test/api'
import { projectMapQueryOptions, topicQueryOptions } from './api/projectMapQuery'
import { sendTopicEdit } from './api/topicEdit'

/*
 * 주제·결정 고치기 (#551 묶음 B, 계약 §4.4.3). 모의 서버가 BE services/summary.py 의 규칙을 따르는지와
 * 응답을 화면 모양으로 읽는지를 본다. 픽스처: tp_01 로그인·계정(dc_01 은 dc_02 가 뒤집음), tp_02 배포·인프라(dc_04 는 유효하지 않음)
 */

const WS = 'ws_01'
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const topic = (id: string) => client().fetchQuery(topicQueryOptions(WS, id))
const map = () => client().fetchQuery(projectMapQueryOptions(WS))

function stubTopic(decision: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  server.use(
    http.get('/api/v1/workspaces/:workspaceId/topics/:topicId', () =>
      ok({
        topic_id: 'tp',
        name: '주제',
        description: '',
        decisions: [
          {
            decision_id: 'd',
            text: '결정',
            reason: null,
            meeting_id: 'm',
            meeting_title: null,
            decided_at: '2026-09-01T00:00:00Z',
            replaced_by: null,
            ...decision,
          },
        ],
        tasks: [],
        meetings: [],
        ...extra,
      }),
    ),
  )
}

describe('주제 응답의 상태와 고침 표시', () => {
  it('#605 전 BE 처럼 state·edited 가 없으면 유효하고 고치지 않은 것으로 읽는다', async () => {
    stubTopic({})
    const detail = await topic('tp')
    expect(detail.edited).toBe(false)
    expect(detail.decisions[0]).toMatchObject({ state: 'valid', edited: false })
  })

  it('고침 표시의 모양이 틀리면 그 표시만 빼고 읽는다', async () => {
    stubTopic({ state: 'invalid', edited: 'yes' }, { edited: 1 })
    const detail = await topic('tp')
    expect(detail.edited).toBe(false)
    expect(detail.decisions[0]).toMatchObject({ state: 'invalid', edited: false })
  })

  it.each([['removed'], ['archived'], [null]])(
    '결정 state 가 %s 이면 주제 전체가 INVALID_RESPONSE 다',
    async (state) => {
      stubTopic({ state })
      await expect(topic('tp')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
        details: { entity: 'topic', path: 'decisions[0].state' },
      })
    },
  )

  it('모의 서버의 유효하지 않은 결정은 상태와 고침이 함께 온다', async () => {
    const detail = await topic('tp_02')
    expect(
      detail.decisions.map(({ decisionId, state, edited }) => [decisionId, state, edited]),
    ).toEqual([
      ['dc_03', 'valid', false],
      ['dc_04', 'invalid', true],
    ])
  })
})

describe('주제 이름·설명 고치기', () => {
  it('보낸 칸만 바꾸고 고친 주제로 표시한다. 맵의 이름도 바뀐다', async () => {
    const detail = await sendTopicEdit(WS, 'tp_02', { kind: 'topic', name: '  배포  ' })
    expect(detail).toMatchObject({
      topicId: 'tp_02',
      name: '배포',
      description: '데이터베이스와 배포 절차를 정리한다.',
      edited: true,
    })
    expect((await map()).nodeById.get('tp_02')?.label).toBe('배포')
  })

  it('다른 주제와 정규화한 이름이 같으면 409 와 그 주제 ID 다. 자기 이름의 표기만 바꾸는 것은 된다', async () => {
    await expect(
      sendTopicEdit(WS, 'tp_02', { kind: 'topic', name: '로그인 · 계정' }),
    ).rejects.toMatchObject({
      code: 'TOPIC_NAME_TAKEN',
      status: 409,
      details: { topic_id: 'tp_01' },
    })
    await expect(
      sendTopicEdit(WS, 'tp_01', { kind: 'topic', name: '로그인/계정' }),
    ).resolves.toMatchObject({ name: '로그인/계정' })
  })

  it('정규화는 NFKC·소문자이고 글자·숫자만 남긴다', () => {
    expect(normalizeTopicName('  ＡＰＩ 배포·인프라! 2 ')).toBe('api배포인프라2')
    expect(normalizeTopicName('·  !')).toBe('')
  })

  it.each([
    ['바꿀 칸이 없음', {}],
    ['공백만인 이름', { name: '   ' }],
    ['100자 넘는 이름', { name: '가'.repeat(101) }],
    ['1000자 넘는 설명', { description: '가'.repeat(1001) }],
    ['글자가 없는 이름', { name: '·!' }],
  ])('%s 은 400 INVALID_REQUEST 다', async (_, body) => {
    await expect(
      fetchDto(`/workspaces/${WS}/topics/tp_02`, { method: 'PATCH', body }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
  })

  it('없거나 다른 공간의 주제는 404 TOPIC_NOT_FOUND 다', async () => {
    await expect(
      sendTopicEdit(WS, 'missing', { kind: 'topic', description: '설명' }),
    ).rejects.toMatchObject({ code: 'TOPIC_NOT_FOUND', status: 404 })
    await expect(
      sendTopicEdit('ws_02', 'tp_01', { kind: 'topic', description: '설명' }),
    ).rejects.toMatchObject({ code: 'TOPIC_NOT_FOUND', status: 404 })
  })
})

describe('주제 합치기', () => {
  it('결정·태스크·회의가 대상 주제로 옮겨 가고 원래 주제는 맵에서 사라진다', async () => {
    const into = await sendTopicEdit(WS, 'tp_02', { kind: 'merge', intoTopicId: 'tp_01' })
    expect(into.topicId).toBe('tp_01')
    expect(into.edited).toBe(true)
    expect(into.decisions.map(({ decisionId }) => decisionId)).toEqual(
      expect.arrayContaining(['dc_01', 'dc_02', 'dc_03', 'dc_04']),
    )
    expect(into.tasks.map(({ taskId }) => taskId).sort()).toEqual(
      ['tk_01', 'tk_02', 'tk_03', 'tk_04', 'tk_07'].sort(),
    )
    const after = await map()
    expect(after.nodeById.has('tp_02')).toBe(false)
    expect(after.topicGroups.find(({ topic }) => topic.id === 'tp_01')?.tasks).toHaveLength(5)
    await expect(topic('tp_02')).rejects.toMatchObject({ code: 'TOPIC_NOT_FOUND' })
  })

  it('자기 자신은 400, 없는 대상은 404 다', async () => {
    await expect(
      sendTopicEdit(WS, 'tp_02', { kind: 'merge', intoTopicId: 'tp_02' }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
    await expect(
      sendTopicEdit(WS, 'tp_02', { kind: 'merge', intoTopicId: 'missing' }),
    ).rejects.toMatchObject({ code: 'TOPIC_NOT_FOUND', status: 404 })
  })
})

describe('태스크 떼기', () => {
  it('주제와 맵에서 그 선이 빠지고 다시 불러도 같다', async () => {
    const first = await sendTopicEdit(WS, 'tp_02', { kind: 'detach', taskId: 'tk_03' })
    expect(first.tasks.map(({ taskId }) => taskId)).toEqual(['tk_04'])
    expect(first.edited).toBe(true)
    const again = await sendTopicEdit(WS, 'tp_02', { kind: 'detach', taskId: 'tk_03' })
    expect(again).toEqual(first)
    expect((await map()).edges).not.toContainEqual({ source: 'tp_02', target: 'tk_03' })
  })

  it('없는 태스크는 404 TASK_NOT_FOUND 다', async () => {
    await expect(
      sendTopicEdit(WS, 'tp_02', { kind: 'detach', taskId: 'missing' }),
    ).rejects.toMatchObject({ code: 'TASK_NOT_FOUND', status: 404 })
  })
})

describe('결정 고치기', () => {
  it('문장을 고치면 그 결정의 주제를 돌려주고 고친 결정으로 표시한다', async () => {
    const detail = await sendTopicEdit(WS, 'tp_01', {
      kind: 'decision',
      decisionId: 'dc_02',
      text: ' 카카오 로그인도 이메일을 확인한다 ',
    })
    expect(detail.topicId).toBe('tp_01')
    expect(detail.decisions[1]).toMatchObject({
      text: '카카오 로그인도 이메일을 확인한다',
      edited: true,
      state: 'valid',
    })
  })

  it('지우면 응답에서 빠지고 그 결정이 뒤집었던 결정이 다시 유효하다. 되살리면 다시 뒤집힌다', async () => {
    const removed = await sendTopicEdit(WS, 'tp_01', {
      kind: 'decision',
      decisionId: 'dc_02',
      state: 'removed',
    })
    expect(removed.decisions.map(({ decisionId, replacedBy }) => [decisionId, replacedBy])).toEqual(
      [['dc_01', null]],
    )

    const restored = await sendTopicEdit(WS, 'tp_01', {
      kind: 'decision',
      decisionId: 'dc_02',
      state: 'valid',
    })
    expect(
      restored.decisions.map(({ decisionId, replacedBy }) => [decisionId, replacedBy]),
    ).toEqual([
      ['dc_01', 'dc_02'],
      ['dc_02', null],
    ])
  })

  it('없는 결정은 404 DECISION_NOT_FOUND, 모르는 상태는 400 이다', async () => {
    await expect(
      sendTopicEdit(WS, 'tp_01', { kind: 'decision', decisionId: 'missing', state: 'invalid' }),
    ).rejects.toMatchObject({ code: 'DECISION_NOT_FOUND', status: 404 })
    await expect(
      fetchDto(`/workspaces/${WS}/decisions/dc_01`, { method: 'PATCH', body: { state: 'gone' } }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
  })
})
