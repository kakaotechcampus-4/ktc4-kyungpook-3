import { QueryClient } from '@tanstack/react-query'
import { settleMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { fetchDto, jsonRequest } from '@/shared/test/api'
import type { WorkspaceDto } from '@/shared/types/api/workspace'
import { discordUsersQueryOptions } from './discordUsers'

const fetchUsers = (workspaceId: string) =>
  new QueryClient().fetchQuery({ ...discordUsersQueryOptions(workspaceId), retry: false })

describe('discordUsersQueryOptions', () => {
  it('key 에 workspaceId 가 있다', () => {
    expect(discordUsersQueryOptions('ws_01').queryKey).toEqual([
      'workspace',
      'ws_01',
      'discord-users',
    ])
  })

  it('연결된 공간의 Discord 사용자를 봇까지 DiscordUser[] 로 받는다', async () => {
    const users = await fetchUsers('ws_01')
    expect(users.map(({ username }) => username)).toEqual([
      'seoyeon_01',
      'minsu',
      'jihun_dev',
      'manager_bot',
    ])
    expect(users.at(-1)).toMatchObject({ isBot: true })
  })

  it('연결 전에는 409 INTEGRATION_NOT_CONNECTED 로 던진다', async () => {
    await expect(fetchUsers('ws_02')).rejects.toMatchObject({
      status: 409,
      code: 'INTEGRATION_NOT_CONNECTED',
    })
  })

  // ws_01 전용이던 픽스처를 걷어 냈다. 새 공간도 Discord 연결 뒤 팀원 연결 단계로 갈 수 있어야 한다
  it('새로 만든 공간도 Discord 를 연결하면 사용자 목록이 온다', async () => {
    const { workspace_id: id } = await fetchDto<WorkspaceDto>(
      '/workspaces',
      jsonRequest('POST', { name: '새 공간' }),
    )
    await expect(fetchUsers(id)).rejects.toMatchObject({ code: 'INTEGRATION_NOT_CONNECTED' })

    expect(settleMockOAuth({ workspaceId: id, provider: 'discord', outcome: 'success' })).toBe(
      'success',
    )
    const users = await fetchUsers(id)
    expect(users.filter(({ isBot }) => !isBot)).toHaveLength(3)
  })
})
