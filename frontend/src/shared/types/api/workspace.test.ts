import { workspaceFixtures } from '@/shared/mock/fixtures/workspace'
import { applyScenario } from '@/shared/mock/scenarios'
import { fetchDto } from '@/shared/test/api'
import { workspaceListSchema, workspaceSchema } from './workspace'

const valid = {
  workspace_id: 'ws_01',
  name: '카테캠 3팀',
  role: 'pm',
  member_id: 'mb_01',
  created_at: '2026-09-01T00:00:00Z',
  onboarding: {
    completed: false,
    current_step: 'connect_notion',
    steps: [{ step: 'create_workspace', status: 'completed' }],
  },
}

describe('워크스페이스 스키마', () => {
  it.each([
    ['모르는 현재 단계', { current_step: 'connect_slack' }, ['onboarding', 'current_step']],
    [
      '모르는 단계 이름',
      { steps: [{ step: 'connect_slack', status: 'pending' }] },
      ['onboarding', 'steps', 0, 'step'],
    ],
    [
      '모르는 단계 상태',
      { steps: [{ step: 'create_workspace', status: 'paused' }] },
      ['onboarding', 'steps', 0, 'status'],
    ],
  ])('%s 는 짐작한 단계로 바꾸지 않고 읽지 않는다', (_, onboarding, path) => {
    const result = workspaceSchema.safeParse({
      ...valid,
      onboarding: { ...valid.onboarding, ...onboarding },
    })
    expect(result.error?.issues[0]?.path).toEqual(path)
  })

  it('완료한 공간의 빈 현재 단계, 없는 역할, 팀원 칸이 없는 옛 응답은 읽는다', () => {
    expect(
      workspaceSchema.safeParse({
        ...valid,
        member_id: undefined,
        role: null,
        onboarding: { ...valid.onboarding, completed: true, current_step: '' },
      }).success,
    ).toBe(true)
  })

  it('모르는 역할은 거절하지 않는다. mapper 가 팀원으로 내린다', () => {
    expect(workspaceSchema.safeParse({ ...valid, role: 'owner' }).success).toBe(true)
  })

  it('온보딩 칸이 없으면 읽지 않는다', () => {
    expect(workspaceSchema.safeParse({ ...valid, onboarding: undefined }).success).toBe(false)
  })
})

describe('MSW handler 응답이 같은 스키마를 따른다', () => {
  it('워크스페이스 픽스처', () => {
    for (const fixture of workspaceFixtures) workspaceSchema.parse(fixture)
  })

  it.each(['multiple-workspaces', 'incomplete-workspace'] as const)(
    '%s 상태의 목록과 상세',
    async (scenario) => {
      applyScenario(scenario)
      const { items } = workspaceListSchema.parse(await fetchDto('/workspaces'))
      expect(items.length).toBeGreaterThan(0)
      for (const { workspace_id } of items)
        workspaceSchema.parse(await fetchDto(`/workspaces/${workspace_id}`))
    },
  )
})
