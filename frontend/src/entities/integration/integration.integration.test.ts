import { fetchDto } from '@/shared/test/api'
import type { IntegrationsDto } from '@/shared/types/api/integration'
import { toIntegrations } from './model/mapper'

it('maps integrations and persists a disconnected provider', async () => {
  expect(
    toIntegrations(await fetchDto<IntegrationsDto>('/workspaces/ws_01/integrations')).discord
      .status,
  ).toBe('connected')
  // 204 무본문이라 fetchDto 로 읽을 수 없다. 상태 코드만 본다
  const removed = await fetch(`${location.origin}/api/v1/workspaces/ws_01/integrations/discord`, {
    method: 'DELETE',
  })
  expect(removed.status).toBe(204)
  expect(await removed.text()).toBe('')
  expect(
    toIntegrations(await fetchDto<IntegrationsDto>('/workspaces/ws_01/integrations')).discord,
  ).toEqual({ provider: 'discord', status: 'not_connected', displayName: null, connectedAt: null })
  await expect(fetchDto('/workspaces/ws_01/discord/members')).rejects.toMatchObject({
    code: 'INTEGRATION_NOT_CONNECTED',
    status: 409,
  })
})

// 실 API 는 get_current_member 가 먼저 돌아 비소속 워크스페이스에 403 을 낸다.
// 워크스페이스가 없는지 여부는 그 뒤에야 알 수 있으므로 404 로 갈 수 없다 (계약 §4.0-②-1)
it('refuses a workspace the user does not belong to before looking it up', async () => {
  await expect(fetchDto('/workspaces/missing/integrations')).rejects.toMatchObject({
    code: 'FORBIDDEN',
    status: 403,
  })
})

// 백엔드는 provider 를 검증하지 않는다. 지울 행이 없으면 아무 일도 없이 204 다
it('accepts an unknown provider without erroring, like the real API', async () => {
  const response = await fetch(`${location.origin}/api/v1/workspaces/ws_01/integrations/unknown`, {
    method: 'DELETE',
  })
  expect(response.status).toBe(204)
  // 기존 연동은 그대로다
  expect(
    toIntegrations(await fetchDto<IntegrationsDto>('/workspaces/ws_01/integrations')).discord
      .status,
  ).toBe('connected')
})
