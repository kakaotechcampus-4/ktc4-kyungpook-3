import type { OnboardingStepStatus, Workspace } from '@/entities/workspace'
import { onboardingExitPath } from '../lib/exitPath'
import { planOnboardingUpdates } from './progress'
import {
  clearReturnWorkspace,
  readReturnWorkspace,
  rememberReturnWorkspace,
} from '@/shared/lib/return-workspace'

function workspace(
  statuses: [
    OnboardingStepStatus,
    OnboardingStepStatus,
    OnboardingStepStatus,
    OnboardingStepStatus,
  ],
  overrides: Partial<Workspace> = {},
): Workspace {
  const steps = (
    ['create_workspace', 'connect_discord', 'connect_notion', 'connect_members'] as const
  ).map((step, index) => ({ step, status: statuses[index] }))
  return {
    id: 'ws_09',
    name: '새 팀',
    role: 'pm',
    memberId: null,
    createdAt: '2026-09-28T00:00:00Z',
    onboarding: {
      completed: statuses.every((status) => status !== 'pending'),
      currentStep: steps.find(({ status }) => status === 'pending')?.step ?? null,
      steps,
    },
    ...overrides,
  }
}

// D-073 개정(2026-09-29, 사용자 결정): Discord 를 건너뛰어도 팀원 연결을 함께 건너뛰지 않는다.
// 예전 기대(팀원 건너뜀을 덧붙임)를 "팀원 단계는 그대로 pending" 으로 바꿨다
describe('planOnboardingUpdates (D-073 개정)', () => {
  it('Discord 를 건너뛰면 Discord 만 저장한다 — 팀원 연결은 pending 으로 남는다', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'pending', 'pending', 'pending']), {
        step: 'connect_discord',
        action: 'skip',
      }),
    ).toEqual([{ step: 'connect_discord', action: 'skip' }])
  })

  it('이미 저장된 단계는 빼고 남은 것만 보낸다 — 재시도는 보낼 것이 없다', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'skipped', 'pending', 'pending']), {
        step: 'connect_discord',
        action: 'skip',
      }),
    ).toEqual([])
  })

  it('Discord 가 건너뜀이어도 다음 저장이 팀원 건너뜀을 채우지 않는다', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'skipped', 'pending', 'pending']), {
        step: 'connect_notion',
        action: 'complete',
      }),
    ).toEqual([{ step: 'connect_notion', action: 'complete' }])
  })

  it('Discord 를 연결했으면 팀원 연결은 그대로 남는다', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'completed', 'pending', 'pending']), {
        step: 'connect_notion',
        action: 'skip',
      }),
    ).toEqual([{ step: 'connect_notion', action: 'skip' }])
  })

  it('건너뛴 Discord 를 둘러보기에서 다시 연결해도 완료 저장은 걸러진다 — 단계 상태는 바꾸지 않는다', () => {
    expect(
      planOnboardingUpdates(workspace(['completed', 'skipped', 'pending', 'pending']), {
        step: 'connect_discord',
        action: 'complete',
      }),
    ).toEqual([])
  })
})

describe('온보딩 나가기 목적지 (D-069)', () => {
  afterEach(() => clearReturnWorkspace())

  const done = workspace(['completed', 'completed', 'completed', 'completed'], { id: 'ws_01' })
  const pending = workspace(['completed', 'pending', 'pending', 'pending'], { id: 'ws_03' })

  it('새 공간 만들기를 시작한 기존 공간이 있으면 그 대시보드다', () => {
    rememberReturnWorkspace('ws_01')
    expect(readReturnWorkspace()).toBe('ws_01')
    expect(onboardingExitPath([done, pending], readReturnWorkspace())).toBe(
      '/workspaces/ws_01/dashboard',
    )
  })

  it('최초 가입자·사라진 공간·미완료 공간은 워크스페이스 선택 화면이다', () => {
    expect(onboardingExitPath([pending], null)).toBe('/workspaces')
    expect(onboardingExitPath([pending], 'ws_77')).toBe('/workspaces')
    expect(onboardingExitPath([pending], 'ws_03')).toBe('/workspaces')
  })

  it('기억은 sessionStorage 에만 있고 지우면 사라진다', () => {
    rememberReturnWorkspace('ws_01')
    expect(sessionStorage.getItem('onboarding-return-workspace')).toBe('ws_01')
    clearReturnWorkspace()
    expect(readReturnWorkspace()).toBeNull()
  })
})
