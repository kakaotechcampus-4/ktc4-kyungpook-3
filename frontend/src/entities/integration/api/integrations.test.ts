import { QueryClient } from '@tanstack/react-query'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { setMockRole } from '@/shared/mock/sessions'
import {
  clearChatChannel,
  disconnectIntegration,
  discordChannelsQueryOptions,
  fetchDiscordChannels,
  fetchIntegrations,
  integrationsQueryOptions,
  setChatChannel,
} from './integrations'
import { integrationStartUrl } from './oauth'

describe('연동 상태', () => {
  it('key 에 workspaceId 가 있다', () => {
    expect(integrationsQueryOptions('ws_01').queryKey).toEqual([
      'workspace',
      'ws_01',
      'integrations',
    ])
  })

  it('Integrations 로 돌려준다', async () => {
    await expect(fetchIntegrations('ws_02')).resolves.toMatchObject({
      discord: { provider: 'discord', status: 'not_connected' },
      notion: { provider: 'notion', status: 'not_connected' },
    })
    const cached = await new QueryClient().fetchQuery(integrationsQueryOptions('ws_01'))
    expect(cached.discord.status).toBe('connected')
  })

  it('비소속 공간은 403 으로 던진다', async () => {
    await expect(fetchIntegrations('ws_99')).rejects.toMatchObject({ status: 403 })
  })
})

describe('연동 해제', () => {
  it('204 무본문이라 undefined 로 끝나고 다음 조회는 미연결이다', async () => {
    await expect(disconnectIntegration('ws_01', 'notion')).resolves.toBeUndefined()
    await expect(fetchIntegrations('ws_01')).resolves.toMatchObject({
      notion: { status: 'not_connected' },
    })
  })
})

describe('회의 채팅 채널 (#428)', () => {
  const GENERAL = '1300000000000000001'

  it('채널 목록은 텍스트 채널의 ID 와 이름이고 key 에 workspaceId 가 있다', async () => {
    expect(discordChannelsQueryOptions('ws_01').queryKey).toEqual([
      'workspace',
      'ws_01',
      'discord-channels',
    ])
    await expect(fetchDiscordChannels('ws_01')).resolves.toContainEqual({
      channelId: GENERAL,
      name: '일반',
    })
  })

  it('Discord 가 연결돼 있지 않으면 목록과 저장이 409 INTEGRATION_NOT_CONNECTED 다', async () => {
    await disconnectIntegration('ws_01', 'discord')
    const notConnected = { status: 409, code: 'INTEGRATION_NOT_CONNECTED' }
    await expect(fetchDiscordChannels('ws_01')).rejects.toMatchObject(notConnected)
    await expect(setChatChannel('ws_01', GENERAL)).rejects.toMatchObject(notConnected)
  })

  it('고른 채널을 저장하면 연동 조회의 discord.chatChannel 이 그 채널이다', async () => {
    await expect(setChatChannel('ws_01', GENERAL)).resolves.toEqual({
      channelId: GENERAL,
      name: '일반',
    })
    expect((await fetchIntegrations('ws_01')).discord.chatChannel).toEqual({
      channelId: GENERAL,
      name: '일반',
    })
  })

  it.each([
    ['1300000000000000003', 'read'],
    ['1300000000000000004', 'send'],
  ])(
    '봇이 다룰 수 없는 채널(%s)은 409 와 need=%s 이고 저장하지 않는다',
    async (channelId, need) => {
      await expect(setChatChannel('ws_01', channelId)).rejects.toMatchObject({
        status: 409,
        code: 'DISCORD_CHANNEL_NOT_ACCESSIBLE',
        details: { channel_id: channelId, need },
      })
      expect((await fetchIntegrations('ws_01')).discord.chatChannel).toBeNull()
    },
  )

  it('서버에 없는 채널은 404, 숫자가 아닌 ID 는 400 이다', async () => {
    await expect(setChatChannel('ws_01', '999')).rejects.toMatchObject({
      status: 404,
      code: 'DISCORD_CHANNEL_NOT_FOUND',
    })
    await expect(setChatChannel('ws_01', 'general')).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    })
  })

  it('끄면 끔 안내를 남겼는지 알려 주고, 이미 꺼져 있어도 성공이다', async () => {
    await setChatChannel('ws_01', GENERAL)
    await expect(clearChatChannel('ws_01')).resolves.toEqual({ offNoticeSent: true })
    expect((await fetchIntegrations('ws_01')).discord.chatChannel).toBeNull()
    await expect(clearChatChannel('ws_01')).resolves.toEqual({ offNoticeSent: false })
  })

  it('Discord 연결을 끊으면 채팅 채널도 함께 사라진다', async () => {
    await setChatChannel('ws_01', GENERAL)
    await disconnectIntegration('ws_01', 'discord')
    expect(db.integrations.ws_01.discord.chat_channel).toBeNull()
  })

  it('PM 이 아니면 목록·저장·끄기가 403 이다', async () => {
    setMockRole('member', 'ws_01')
    const forbidden = { status: 403, code: 'FORBIDDEN' }
    await expect(fetchDiscordChannels('ws_01')).rejects.toMatchObject(forbidden)
    await expect(setChatChannel('ws_01', GENERAL)).rejects.toMatchObject(forbidden)
    await expect(clearChatChannel('ws_01')).rejects.toMatchObject(forbidden)
  })
})

describe('integrationStartUrl', () => {
  // Vitest 는 MSW 모드가 아니다(VITE_ENABLE_MSW 없음). 실 API 의 start 주소가 나와야 한다
  it('MSW 모드가 아니면 실 API 의 start 에 state 로 복귀 경로를 싣는다 (D-158)', () => {
    const returnPath = paths.onboardingStep('ws_03', 'connect_discord')
    const url = new URL(integrationStartUrl('ws_03', 'discord', returnPath), location.origin)
    expect(url.pathname).toBe('/api/v1/workspaces/ws_03/integrations/discord/start')
    expect(url.searchParams.get('state')).toBe(returnPath)
  })
})
