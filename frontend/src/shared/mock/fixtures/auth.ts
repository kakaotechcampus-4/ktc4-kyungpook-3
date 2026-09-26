import type { SessionDto } from '@/shared/types/api/auth'

export const mockPassword = 'mock-password'
export const sessionFixture: SessionDto = {
  user: { user_id: 'us_01', email: 'pm@example.com', name: '최진호', avatar_url: null },
  workspace_count: 2,
  last_workspace_id: 'ws_01',
}
