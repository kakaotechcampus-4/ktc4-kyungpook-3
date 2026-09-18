import type { WorkspaceDto } from '@/shared/types/api/workspace'
export const workspaceFixtures: WorkspaceDto[] = [
  {
    workspace_id: 'ws_01',
    name: '카테캠 3팀',
    role: 'pm',
    created_at: '2026-09-01T00:00:00Z',
    onboarding: {
      completed: true,
      current_step: null,
      steps: ['create_workspace', 'connect_discord', 'connect_notion', 'connect_members'].map(
        (step) => ({ step, status: 'completed' }),
      ),
    },
  },
  {
    workspace_id: 'ws_02',
    name: '사이드 프로젝트',
    role: 'member',
    created_at: '2026-09-02T00:00:00Z',
    onboarding: {
      completed: false,
      current_step: 'connect_notion',
      steps: [
        { step: 'create_workspace', status: 'completed' },
        { step: 'connect_discord', status: 'skipped' },
        { step: 'connect_notion', status: 'pending' },
        { step: 'connect_members', status: 'pending' },
      ],
    },
  },
]
