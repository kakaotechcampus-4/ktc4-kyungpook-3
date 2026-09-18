import type { IntegrationsDto } from '@/shared/types/api/integration'
export const integrationFixtures: Record<string, IntegrationsDto> = {
  ws_01: {
    discord: {
      status: 'connected',
      display_name: '카테캠 3팀 서버',
      connected_at: '2026-09-01T01:00:00Z',
    },
    notion: {
      status: 'connected',
      display_name: '카테캠 3팀 태스크',
      connected_at: '2026-09-01T02:00:00Z',
    },
  },
  ws_02: {
    discord: { status: 'not_connected', display_name: null, connected_at: null },
    notion: { status: 'not_connected', display_name: null, connected_at: null },
  },
}
