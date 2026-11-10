import type { QueryClient } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { workspaceKey } from '@/shared/api/queryKeys'
import { topicDetailSchema } from '@/shared/types/api/projectMap'
import { toTopicDetail } from '../model/mapper'
import type { TopicDetail } from '../model/types'
import { topicQueryOptions } from './projectMapQuery'

/** 결정에 보낼 수 있는 상태. `removed` 는 지우기이고, 그 뒤 응답에는 그 결정이 없다 */
export type DecisionWriteState = 'valid' | 'invalid' | 'removed'

/** 주제 패널에서 하는 고치기 하나 (계약 §4.4.3). 바꿀 칸만 담는다 */
export type TopicEdit =
  | { kind: 'topic'; name?: string; description?: string }
  | { kind: 'merge'; intoTopicId: string }
  | { kind: 'detach'; taskId: string }
  | { kind: 'decision'; decisionId: string; text?: string; state?: DecisionWriteState }

export type TopicEditKind = TopicEdit['kind']
type EditOf<K extends TopicEditKind> = Extract<TopicEdit, { kind: K }>

interface EditRequest {
  method: 'PATCH' | 'POST' | 'DELETE'
  path: string
  body?: Record<string, unknown>
}

interface EditSpec<E> {
  request: (edit: E, at: { workspacePath: string; topicPath: string }) => EditRequest
  /** 회의록이 지금 행에서 읽는 값(주제 이름, 결정, 회의의 주제)을 바꾼다 */
  touchesMinutes: (edit: E) => boolean
  /** 고친 주제가 없어진다. 응답은 다른 주제다 */
  removesTopic: boolean
}

const id = encodeURIComponent

const EDITS: { [K in TopicEditKind]: EditSpec<EditOf<K>> } = {
  topic: {
    request: ({ name, description }, { topicPath }) => ({
      method: 'PATCH',
      path: topicPath,
      body: { name, description },
    }),
    touchesMinutes: ({ name }) => name !== undefined,
    removesTopic: false,
  },
  merge: {
    request: ({ intoTopicId }, { topicPath }) => ({
      method: 'POST',
      path: `${topicPath}/merge`,
      body: { into_topic_id: intoTopicId },
    }),
    touchesMinutes: () => true,
    removesTopic: true,
  },
  detach: {
    request: ({ taskId }, { topicPath }) => ({
      method: 'DELETE',
      path: `${topicPath}/tasks/${id(taskId)}`,
    }),
    touchesMinutes: () => false,
    removesTopic: false,
  },
  decision: {
    request: ({ decisionId, text, state }, { workspacePath }) => ({
      method: 'PATCH',
      path: `${workspacePath}/decisions/${id(decisionId)}`,
      body: { text, state },
    }),
    touchesMinutes: () => true,
    removesTopic: false,
  },
}

function specOf<K extends TopicEditKind>(edit: EditOf<K>): EditSpec<EditOf<K>> {
  return EDITS[edit.kind]
}

/** 고치고 돌려받은 주제를 읽는다. 합치기는 합친 주제, 결정은 그 결정의 주제다 */
export async function sendTopicEdit(
  workspaceId: string,
  topicId: string,
  edit: TopicEdit,
  init: { signal?: AbortSignal } = {},
): Promise<TopicDetail> {
  const workspacePath = `/workspaces/${id(workspaceId)}`
  const { method, path, body } = specOf(edit).request(edit, {
    workspacePath,
    topicPath: `${workspacePath}/topics/${id(topicId)}`,
  })
  const data = await request<unknown>(path, { method, body, signal: init.signal })
  return toTopicDetail(parseResponse(topicDetailSchema, data, 'topic'))
}

/**
 * 고친 뒤의 캐시 (계약 §4.4.3 「고친 뒤 FE 가 다시 받을 캐시」). 응답은 그 주제 키에 쓰고 맵은 접두로 다시 받는다 —
 * 결정을 고치면 다른 주제에 있는 옛 결정의 뒤집힘도 바뀐다. 회의록은 무효로만 둔다
 */
export function writeTopicEdit(
  queryClient: QueryClient,
  workspaceId: string,
  topicId: string,
  edit: TopicEdit,
  topic: TopicDetail,
): void {
  const spec = specOf(edit)
  queryClient.setQueryData(topicQueryOptions(workspaceId, topic.topicId).queryKey, topic)
  if (spec.removesTopic)
    queryClient.removeQueries({
      queryKey: topicQueryOptions(workspaceId, topicId).queryKey,
      exact: true,
    })
  void queryClient.invalidateQueries({ queryKey: workspaceKey(workspaceId, 'project-map') })
  if (spec.touchesMinutes(edit))
    void queryClient.invalidateQueries({ queryKey: workspaceKey(workspaceId, 'minutes') })
}

/** 응답을 읽지 못했거나 대상이 사라졌을 때 다시 받을 것. 무엇이 바뀌었는지 모르므로 고치기가 닿는 곳 전부다 */
export function refreshTopicEdits(queryClient: QueryClient, workspaceId: string): void {
  void queryClient.invalidateQueries({ queryKey: workspaceKey(workspaceId, 'project-map') })
  void queryClient.invalidateQueries({ queryKey: workspaceKey(workspaceId, 'minutes') })
}
