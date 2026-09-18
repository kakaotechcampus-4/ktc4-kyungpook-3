import { toWorkspace } from './mapper'

it('maps workspace onboarding and safe defaults unknown values', () => {
  expect(
    toWorkspace({
      workspace_id: 'ws_02',
      name: '사이드 프로젝트',
      role: 'member',
      created_at: '2026-09-01T00:00:00Z',
      onboarding: {
        completed: false,
        current_step: 'connect_notion',
        steps: [{ step: 'connect_discord', status: 'skipped' }],
      },
    }),
  ).toMatchObject({ id: 'ws_02', onboarding: { currentStep: 'connect_notion' } })
})

it('uses safe defaults for unrecognized role, step, and status', async () => {
  const { toWorkspace } = await import('./mapper')
  expect(
    toWorkspace({
      workspace_id: 'ws',
      name: 'W',
      role: 'owner',
      created_at: '',
      onboarding: {
        completed: false,
        current_step: 'future_step',
        steps: [{ step: 'future_step', status: 'future' }],
      },
    }),
  ).toMatchObject({
    role: 'member',
    onboarding: { currentStep: null, steps: [{ step: 'create_workspace', status: 'pending' }] },
  })
})
