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

// 백엔드는 온보딩이 끝나면 current_step 에 null 이 아니라 빈 문자열을 넣는다 (계약 §4.0-②-4).
// 빈 문자열을 그대로 safeStep 에 넘기면 "모르는 단계" 경고가 뜬다. 조용히 null 로 다뤄야 한다
it('treats the backend empty current_step as no current step without warning', () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    expect(
      toWorkspace({
        workspace_id: 'ws_01',
        name: '카테캠 3팀',
        role: 'pm',
        created_at: '2026-09-01T00:00:00Z',
        onboarding: {
          completed: true,
          current_step: '',
          steps: [{ step: 'create_workspace', status: 'completed' }],
        },
      }),
    ).toMatchObject({ onboarding: { completed: true, currentStep: null } })
    expect(warning).not.toHaveBeenCalled()
  } finally {
    warning.mockRestore()
  }
})
