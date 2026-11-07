import { queryOptions, useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { STALE_TIME } from '@/shared/api/queryClient'
import type { ListDto } from '@/shared/types/api/envelope'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { findMemberWorkspace } from '../lib/membership'
import { toWorkspace } from '../model/mapper'
import type { Workspace } from '../model/types'

/** 사용자 범위 key 다. 첫 칸이 'workspace' 인 워크스페이스 범위 key 와 접두어가 겹치지 않게 이름을 따로 둔다 */
export const WORKSPACE_LIST_QUERY_KEY = ['workspace-list'] as const

/** 목록에 role 과 onboarding 이 함께 온다 — 상세를 다시 부르지 않는다 (계약 §2.1, D-070) */
export async function fetchWorkspaces(signal?: AbortSignal): Promise<Workspace[]> {
  const { items } = await request<ListDto<WorkspaceDto>>('/workspaces', { signal })
  return items.map(toWorkspace)
}

/** 부팅이 시작하고 가드가 구독한다 */
export function workspaceListQueryOptions() {
  return queryOptions({
    queryKey: WORKSPACE_LIST_QUERY_KEY,
    queryFn: ({ signal }) => fetchWorkspaces(signal),
    staleTime: STALE_TIME.long,
  })
}

/**
 * 새 사용자의 워크스페이스 목록을 서버에서 새로 받는다. 이 목록으로 로그인·초대 수락 뒤 갈 곳을 정한다 (D-010).
 * 진행 중인 목록 요청은 먼저 취소한다 — fetchQuery 는 그 요청을 그대로 이어받는데, 그 응답은 로그인·수락 전 소속이다
 */
export async function fetchFreshWorkspaces(queryClient: QueryClient): Promise<Workspace[]> {
  await queryClient.cancelQueries({ queryKey: WORKSPACE_LIST_QUERY_KEY, exact: true })
  return queryClient.fetchQuery({ ...workspaceListQueryOptions(), staleTime: 0 })
}

/** 소속 공간 하나. 가드와 같은 목록 캐시를 구독해서 고른다. 소속이 아니면 null */
export function useMemberWorkspace(workspaceId: string | null): Workspace | null {
  const { data } = useQuery({
    ...workspaceListQueryOptions(),
    select: (workspaces) => findMemberWorkspace(workspaces, workspaceId),
  })
  return data ?? null
}
