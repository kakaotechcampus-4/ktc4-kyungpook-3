import { queryOptions } from '@tanstack/react-query'
import { request } from '@/shared/api/client'
import { parseResponse } from '@/shared/api/parseResponse'
import { workspaceKey } from '@/shared/api/queryKeys'
import { discordUserListSchema } from '@/shared/types/api/member'
import { toDiscordUser } from '../model/mapper'

/**
 * 연결된 Discord 서버의 사용자. 봇도 온다 — 걸러 내는 것은 `linkDiscordUsers` 다.
 * Discord 가 연결되지 않았으면 409 `INTEGRATION_NOT_CONNECTED` 다.
 */
export function discordUsersQueryOptions(workspaceId: string) {
  return queryOptions({
    queryKey: workspaceKey(workspaceId, 'discord-users'),
    queryFn: async ({ signal }) => {
      const { items } = parseResponse(
        discordUserListSchema,
        await request<unknown>(`/workspaces/${encodeURIComponent(workspaceId)}/discord/members`, {
          signal,
        }),
        'member',
      )
      return items.map(toDiscordUser)
    },
  })
}
