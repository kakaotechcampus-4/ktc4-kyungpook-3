import type { QueryClient } from '@tanstack/react-query'
import { integrationsQueryOptions } from '@/entities/integration'
import { discordUsersQueryOptions, memberListQueryOptions } from '@/entities/member'
import { taskListQueryOptions } from '@/entities/task'

/**
 * 팀 화면의 첫 화면 조회를 미리 받는다 (#536).
 * 이 파일은 화면 코드와 따로 부를 수 있는 입구다 — 셸이 정적으로 가져와도 팀 화면이 첫 번들에 끼지 않는다.
 *
 * 화면(TeamOverview)과 같은 query options · 같은 규칙이다. Discord 사용자 목록은 연동 상태를 아직 모르거나 연결됐을 때만 묻는다 —
 * 화면도 연동을 받기 전에는 함께 묻는다. 이미 받은 값은 다시 받지 않고(`prefetchQuery`) 실패는 삼킨다.
 */
export async function prefetchTeamOverview(
  queryClient: QueryClient,
  { workspaceId }: { workspaceId: string },
): Promise<void> {
  const discordStatus = queryClient.getQueryData(integrationsQueryOptions(workspaceId).queryKey)
    ?.discord.status
  await Promise.all([
    queryClient.prefetchQuery(memberListQueryOptions(workspaceId)),
    queryClient.prefetchQuery(taskListQueryOptions(workspaceId)),
    queryClient.prefetchQuery(integrationsQueryOptions(workspaceId)),
    discordStatus === undefined || discordStatus === 'connected'
      ? queryClient.prefetchQuery(discordUsersQueryOptions(workspaceId))
      : null,
  ])
}
