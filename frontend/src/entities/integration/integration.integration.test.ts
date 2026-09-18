import { fetchDto } from '@/shared/test/api'
import type { IntegrationsDto } from '@/shared/types/api/integration'
import { toIntegrations } from './model/mapper'

it('maps integrations and persists a disconnected provider', async () => {
  expect(
    toIntegrations(await fetchDto<IntegrationsDto>('/workspaces/ws_01/integrations')).discord
      .status,
  ).toBe('connected')
  await fetchDto('/workspaces/ws_01/integrations/discord', { method: 'DELETE' })
  expect(
    toIntegrations(await fetchDto<IntegrationsDto>('/workspaces/ws_01/integrations')).discord,
  ).toEqual({ provider: 'discord', status: 'not_connected', displayName: null, connectedAt: null })
  await expect(fetchDto('/workspaces/ws_01/discord/members')).rejects.toMatchObject({
    code: 'INTEGRATION_NOT_CONNECTED',
    status: 409,
  })
})

it('returns absent workspace and invalid provider errors', async () => {
  await expect(fetchDto('/workspaces/missing/integrations')).rejects.toMatchObject({
    code: 'WORKSPACE_NOT_FOUND',
    status: 404,
  })
  await expect(
    fetchDto('/workspaces/ws_01/integrations/unknown', { method: 'DELETE' }),
  ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 400 })
})
