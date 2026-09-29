import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { STALE_TIME } from '@/shared/api/queryClient'
import { workspaceKey } from '@/shared/api/queryKeys'
import type { ListDto } from '@/shared/types/api/envelope'
import type { MemberDto } from '@/shared/types/api/member'
import { toMember } from '../model/mapper'

/** 팀원은 자주 바뀌지 않아 5분 동안 최신으로 본다 (D-136) */
export function memberListQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'members'),
    queryFn: async ({ signal }) => {
      const { items } = await request<ListDto<MemberDto>>('/members', {
        params: { workspace_id: workspaceId },
        signal,
      })
      return items.map(toMember)
    },
    staleTime: STALE_TIME.long,
  })
}
