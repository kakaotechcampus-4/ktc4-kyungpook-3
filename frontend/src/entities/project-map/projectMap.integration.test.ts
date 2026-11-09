import { QueryClient } from '@tanstack/react-query'
import { http } from 'msw'
import { ok } from '@/shared/mock/envelope'
import { db } from '@/shared/mock/db'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { fetchDto } from '@/shared/test/api'
import { projectMapSchema, topicDetailSchema } from '@/shared/types/api/projectMap'
import { projectMapQueryOptions, topicQueryOptions } from './api/projectMapQuery'

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

describe('프로젝트 맵 응답 (#551)', () => {
  it('모의 handler 의 맵·주제 응답이 화면과 같은 스키마로 읽힌다', async () => {
    projectMapSchema.parse(await fetchDto('/workspaces/ws_01/project-map'))
    for (const { topic_id } of db.projectMap.topics)
      topicDetailSchema.parse(await fetchDto(`/workspaces/ws_01/topics/${topic_id}`))
  })

  it('주제에 이어진 태스크는 그 주제 아래, 이어지지 않은 태스크는 주제 없는 목록이다', async () => {
    const map = await client().fetchQuery(projectMapQueryOptions('ws_01'))
    expect(
      map.topicGroups.map(({ topic, tasks }) => [topic.label, tasks.map(({ id }) => id)]),
    ).toEqual([
      ['로그인·계정', ['tk_07', 'tk_02', 'tk_01']],
      ['디자인 정리', ['tk_08', 'tk_09']],
      ['회의 요약 품질', ['tk_05', 'tk_06']],
      ['배포·인프라', ['tk_03', 'tk_04']],
    ])
    expect(map.looseTasks.map(({ id }) => id)).toEqual(['tk_10'])
    expect(map.nodes.map(({ appearedAt }) => Date.parse(appearedAt))).toEqual(
      map.nodes.map(({ appearedAt }) => Date.parse(appearedAt)).sort((a, b) => a - b),
    )
    expect(map.nodeById.get('tk_03')).toMatchObject({
      kind: 'task',
      status: 'blocked',
      blocker: 'Notion 권한 대기',
      assigneeName: '이재환',
      meetingIds: ['mt_09'],
    })
  })

  it('없는 노드를 가리키는 선은 버린다', async () => {
    server.use(
      http.get('/api/v1/workspaces/:workspaceId/project-map', () =>
        ok({
          meetings: [],
          nodes: [{ id: 'tp', kind: 'topic', label: '주제', appeared_at: '2026-09-01T00:00:00Z' }],
          edges: [{ source: 'tp', target: 'gone' }],
        }),
      ),
    )
    const map = await client().fetchQuery(projectMapQueryOptions('ws_01'))
    expect(map.edges).toEqual([])
    expect(map.topicGroups).toEqual([{ topic: map.nodeById.get('tp'), tasks: [] }])
  })

  it.each([
    [
      '모르는 노드 종류',
      { id: 'x', kind: 'decision', label: '결정', appeared_at: '2026-09-01T00:00:00Z' },
    ],
    [
      '모르는 태스크 상태',
      {
        id: 'x',
        kind: 'task',
        label: '태스크',
        status: 'archived',
        due_date: null,
        assignee_name: null,
        blocker: null,
        meeting_ids: [],
        appeared_at: '2026-09-01T00:00:00Z',
      },
    ],
  ])('%s면 맵 전체가 INVALID_RESPONSE 다', async (_, node) => {
    server.use(
      http.get('/api/v1/workspaces/:workspaceId/project-map', () =>
        ok({ meetings: [], nodes: [node], edges: [] }),
      ),
    )
    await expect(client().fetchQuery(projectMapQueryOptions('ws_01'))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      details: { entity: 'project-map' },
    })
  })

  it('뒤집힌 결정은 뒤집은 결정을 가리키고, 없거나 다른 공간의 주제는 404 TOPIC_NOT_FOUND 다', async () => {
    const topic = await client().fetchQuery(topicQueryOptions('ws_01', 'tp_01'))
    expect(topic.decisions.map(({ decisionId, replacedBy }) => [decisionId, replacedBy])).toEqual([
      ['dc_01', 'dc_02'],
      ['dc_02', null],
    ])
    expect(topic.meetings.map(({ meetingId }) => meetingId)).toEqual(['mt_07', 'mt_09'])
    await expect(fetchDto('/workspaces/ws_01/topics/missing')).rejects.toMatchObject({
      code: 'TOPIC_NOT_FOUND',
      status: 404,
    })
    await expect(fetchDto('/workspaces/ws_02/topics/tp_01')).rejects.toMatchObject({
      code: 'TOPIC_NOT_FOUND',
      status: 404,
    })
  })

  it('큰 맵 시나리오는 주제 40 · 태스크 510 이고 선이 모두 있는 노드를 가리킨다', async () => {
    applyScenario('project-map-large')
    const dto = projectMapSchema.parse(await fetchDto('/workspaces/ws_01/project-map'))
    expect(dto.nodes.filter(({ kind }) => kind === 'topic')).toHaveLength(40)
    expect(dto.nodes.filter(({ kind }) => kind === 'task')).toHaveLength(510)
    expect(dto.edges.length).toBeGreaterThanOrEqual(1173)
    const ids = new Set(dto.nodes.map(({ id }) => id))
    expect(dto.edges.every(({ source, target }) => ids.has(source) && ids.has(target))).toBe(true)
  })
})
