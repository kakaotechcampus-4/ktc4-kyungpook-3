import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { workspaceKey } from '@/shared/api/queryKeys'
import { projectMapSchema, topicDetailSchema } from '@/shared/types/api/projectMap'
import { toProjectMap, toTopicDetail } from '../model/mapper'

const workspacePath = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}`

/** 맵 전체. 태스크가 바뀌면 같이 바뀌므로 태스크 목록과 같은 기본 최신 시간(30초)을 쓴다 */
export function projectMapQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'project-map'),
    queryFn: async ({ signal }) =>
      toProjectMap(
        parseResponse(
          projectMapSchema,
          await request<unknown>(`${workspacePath(workspaceId)}/project-map`, { signal }),
          'project-map',
        ),
      ),
  })
}

/** 주제 패널. 없거나 다른 공간의 주제는 404 `TOPIC_NOT_FOUND` 다 */
export function topicQueryOptions(workspaceId: string, topicId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'project-map', 'topic', topicId),
    queryFn: async ({ signal }) =>
      toTopicDetail(
        parseResponse(
          topicDetailSchema,
          await request<unknown>(
            `${workspacePath(workspaceId)}/topics/${encodeURIComponent(topicId)}`,
            { signal },
          ),
          'topic',
        ),
      ),
  })
}
