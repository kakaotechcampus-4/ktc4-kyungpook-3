import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { STALE_TIME } from '@/shared/api/queryClient'
import { workspaceKey } from '@/shared/api/queryKeys'
import type { ListDto } from '@/shared/types/api/envelope'
import type { InvitationDto, MyInvitationDto } from '@/shared/types/api/invitation'
import { latestByMember } from '../lib/latestByMember'
import { toInvitation, toMyInvitation } from '../model/mapper'

/** PM 만 부를 수 있다(그 밖은 403). 값은 팀원마다 가장 최근 초대다 — 이력은 캐시에 두지 않는다 */
export function latestInvitationsQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'invitations'),
    queryFn: async ({ signal }) => {
      const { items } = await request<ListDto<InvitationDto>>(
        `/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
        { signal },
      )
      return latestByMember(items.map(toInvitation))
    },
    staleTime: STALE_TIME.long,
  })
}

/** 사용자 범위 key 다. 'workspace' 접두어 밖이라 로그인·로그아웃 때 clearUserScope 가 버린다 */
export function myInvitationsQueryOptions() {
  return queryOptions({
    queryKey: ['my-invitations'] as const,
    queryFn: async ({ signal }) => {
      const { items } = await request<ListDto<MyInvitationDto>>('/invitations/me', { signal })
      return items.map(toMyInvitation)
    },
  })
}
