import type { ChatChannelDto, IntegrationsDto } from '@/shared/types/api/integration'
export const integrationFixtures: Record<string, IntegrationsDto> = {
  ws_01: {
    discord: {
      status: 'connected',
      display_name: '카테캠 3팀 서버',
      connected_at: '2026-09-01T01:00:00Z',
      chat_channel: null,
    },
    notion: {
      status: 'connected',
      display_name: '카테캠 3팀 태스크',
      connected_at: '2026-09-01T02:00:00Z',
    },
  },
  ws_02: {
    discord: {
      status: 'not_connected',
      display_name: null,
      connected_at: null,
      chat_channel: null,
    },
    notion: { status: 'not_connected', display_name: null, connected_at: null },
  },
}

/**
 * 모의 Discord 서버의 텍스트 채널. `access` 는 봇이 그 채널에서 할 수 있는 일이다 —
 * `no_read` 는 메시지 읽기 확인에서, `no_send` 는 켬 안내 보내기에서 Discord 가 403 을 준다 (backend chat_channel.set_chat_channel)
 */
export interface MockDiscordChannel extends ChatChannelDto {
  access: 'ok' | 'no_read' | 'no_send'
}

export const discordChannelFixtures: MockDiscordChannel[] = [
  { channel_id: '1300000000000000001', name: '일반', access: 'ok' },
  { channel_id: '1300000000000000002', name: '회의록', access: 'ok' },
  { channel_id: '1300000000000000003', name: '운영-비공개', access: 'no_read' },
  { channel_id: '1300000000000000004', name: '공지', access: 'no_send' },
]
