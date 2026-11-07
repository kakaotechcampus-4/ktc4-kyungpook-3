import type {
  ChatChannelDto,
  IntegrationDto,
  IntegrationsDto,
} from '@/shared/types/api/integration'
import { enumValue } from '@/shared/lib/enum'
import type { ChatChannel, Integration, IntegrationProvider, Integrations } from './types'

function toIntegration(dto: IntegrationDto, provider: IntegrationProvider): Integration {
  return {
    provider,
    status: enumValue(
      dto.status,
      ['not_connected', 'connecting', 'connected', 'revoked'] as const,
      'not_connected',
      'integration status',
    ),
    displayName: dto.display_name,
    connectedAt: dto.connected_at,
  }
}
export function toChatChannel(dto: ChatChannelDto): ChatChannel {
  return { channelId: dto.channel_id, name: dto.name }
}
export function toIntegrations(dto: IntegrationsDto): Integrations {
  return {
    discord: {
      ...toIntegration(dto.discord, 'discord'),
      chatChannel: dto.discord.chat_channel ? toChatChannel(dto.discord.chat_channel) : null,
    },
    notion: toIntegration(dto.notion, 'notion'),
  }
}
