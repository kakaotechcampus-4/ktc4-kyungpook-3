import type { IntegrationDto, IntegrationsDto } from '@/shared/types/api/integration'
import { enumValue } from '@/shared/lib/enum'
import type { Integration, IntegrationProvider, Integrations } from './types'

function toIntegration(dto: IntegrationDto, provider: IntegrationProvider): Integration {
  return {
    provider,
    status: enumValue(
      dto.status,
      ['not_connected', 'connected', 'revoked'] as const,
      'not_connected',
      'integration status',
    ),
    displayName: dto.display_name,
    connectedAt: dto.connected_at,
  }
}
export function toIntegrations(dto: IntegrationsDto): Integrations {
  return {
    discord: toIntegration(dto.discord, 'discord'),
    notion: toIntegration(dto.notion, 'notion'),
  }
}
