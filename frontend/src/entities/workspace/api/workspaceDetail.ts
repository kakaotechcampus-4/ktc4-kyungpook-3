import { queryOptions } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { STALE_TIME } from '@/shared/api/queryClient'
import { workspaceKey } from '@/shared/api/queryKeys'
import type { WorkspaceCreateDto, WorkspaceDto } from '@/shared/types/api/workspace'
import { toWorkspace } from '../model/mapper'
import type { CreateWorkspaceInput, Workspace } from '../model/types'
import { WORKSPACE_LIST_QUERY_KEY } from './workspaceList'

/**
 * 상세. 소속 판정에 쓰지 않는다 — 소속은 목록으로 본다(lib/membership.ts). 실 API 는 비소속에게 403 을 준다.
 * 온보딩 PATCH 뒤 갱신된 상태를 읽는 용도다.
 */
export async function fetchWorkspace(
  workspaceId: string,
  signal?: AbortSignal,
): Promise<Workspace> {
  return toWorkspace(
    await request<WorkspaceDto>(`/workspaces/${encodeURIComponent(workspaceId)}`, { signal }),
  )
}

export function workspaceDetailQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'detail'),
    queryFn: ({ signal }) => fetchWorkspace(workspaceId, signal),
    staleTime: STALE_TIME.long,
  })
}

/** 201. 생성자가 PM 팀원으로 함께 저장된다. 같은 계정 안의 같은 이름은 409 `WORKSPACE_NAME_DUPLICATED` */
export async function createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
  const body: WorkspaceCreateDto = { name: input.name }
  return toWorkspace(await request<WorkspaceDto>('/workspaces', { method: 'POST', body }))
}

/**
 * 목록 캐시의 한 공간을 바꾸거나 맨 앞에 넣는다. 목록은 생성일 내림차순이라 새 공간이 맨 앞이다.
 * 목록을 아직 받지 않았으면 건드리지 않는다 — 가드가 구독하면서 새로 받는다.
 */
export function upsertWorkspaceInList(queryClient: QueryClient, workspace: Workspace): void {
  queryClient.setQueryData<Workspace[]>(WORKSPACE_LIST_QUERY_KEY, (workspaces) => {
    if (workspaces === undefined) return undefined
    return workspaces.some(({ id }) => id === workspace.id)
      ? workspaces.map((item) => (item.id === workspace.id ? workspace : item))
      : [workspace, ...workspaces]
  })
}
