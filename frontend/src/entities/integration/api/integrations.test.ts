import { QueryClient } from '@tanstack/react-query'
import { paths } from '@/shared/config/routes'
import { fetchIntegrations, integrationsQueryOptions } from './integrations'
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

describe('integrationStartUrl', () => {
  // Vitest 는 MSW 모드가 아니다(VITE_ENABLE_MSW 없음). 실 API 의 start 주소가 나와야 한다
  it('MSW 모드가 아니면 실 API 의 start 에 state 로 복귀 경로를 싣는다 (D-158)', () => {
    const returnPath = paths.onboardingStep('ws_03', 'connect_discord')
    const url = new URL(integrationStartUrl('ws_03', 'discord', returnPath), location.origin)
    expect(url.pathname).toBe('/api/v1/workspaces/ws_03/integrations/discord/start')
    expect(url.searchParams.get('state')).toBe(returnPath)
  })
})
