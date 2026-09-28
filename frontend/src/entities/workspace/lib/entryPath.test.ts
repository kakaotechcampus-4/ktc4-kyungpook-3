import { ONBOARDING_STEPS, readOnboardingStep } from '../model/onboardingSteps'
import type { OnboardingProgress, Workspace } from '../model/types'
import {
  authRevisitPath,
  onboardingResumePath,
  postLoginPath,
  resumeStep,
  workspaceEntryPath,
} from './entryPath'
import { findMemberWorkspace } from './membership'

const DONE: OnboardingProgress = { completed: true, currentStep: null, steps: [] }

function unfinished(progress: Partial<OnboardingProgress>): OnboardingProgress {
  return { completed: false, currentStep: null, steps: [], ...progress }
}

function workspace(id: string, onboarding: OnboardingProgress = DONE): Workspace {
  return { id, name: id, role: 'pm', createdAt: '2026-09-01T00:00:00Z', onboarding }
}

describe('resumeStep', () => {
  it('서버의 현재 단계가 먼저다', () => {
    expect(
      resumeStep(
        unfinished({
          currentStep: 'connect_notion',
          steps: [{ step: 'connect_discord', status: 'pending' }],
        }),
      ),
    ).toBe('connect_notion')
  })

  it('현재 단계가 없거나 잘못됐으면(mapper 가 null 로 내림) 첫 pending 단계다', () => {
    expect(
      resumeStep(
        unfinished({
          steps: [
            { step: 'create_workspace', status: 'completed' },
            { step: 'connect_discord', status: 'skipped' },
            { step: 'connect_members', status: 'pending' },
          ],
        }),
      ),
    ).toBe('connect_members')
  })

  it('pending 도 없으면 생성 단계다', () => {
    expect(
      resumeStep(unfinished({ steps: [{ step: 'connect_discord', status: 'completed' }] })),
    ).toBe('create_workspace')
  })
})

describe('workspaceEntryPath', () => {
  it('완료한 공간은 대시보드다', () => {
    expect(workspaceEntryPath(workspace('ws_01'))).toBe('/workspaces/ws_01/dashboard')
  })

  it('미완료 공간은 언제나 온보딩이다', () => {
    const ws02 = workspace('ws_02', unfinished({ currentStep: 'connect_notion' }))
    expect(workspaceEntryPath(ws02)).toBe('/onboarding/ws_02/connect_notion')
    expect(onboardingResumePath(ws02)).toBe('/onboarding/ws_02/connect_notion')
  })
})

describe('postLoginPath — 로그인 완료', () => {
  it('0개면 생성 온보딩이다', () => {
    expect(postLoginPath([])).toBe('/onboarding/create_workspace')
  })

  it('1개면 그 공간이다', () => {
    expect(postLoginPath([workspace('ws_01')])).toBe('/workspaces/ws_01/dashboard')
  })

  it('1개가 미완료면 그 공간의 온보딩이다', () => {
    expect(postLoginPath([workspace('ws_02', unfinished({ currentStep: 'connect_notion' }))])).toBe(
      '/onboarding/ws_02/connect_notion',
    )
  })

  it('여러 개면 선택 화면이다', () => {
    expect(postLoginPath([workspace('ws_01'), workspace('ws_02')])).toBe('/workspaces')
  })
})

describe('authRevisitPath — 인증 화면 재접근', () => {
  const list = [
    workspace('ws_01'),
    workspace('ws_02', unfinished({ currentStep: 'connect_notion' })),
  ]

  it('유효한 lastWorkspaceId 가 먼저다', () => {
    expect(authRevisitPath(list, 'ws_01')).toBe('/workspaces/ws_01/dashboard')
  })

  it('마지막 공간이 미완료면 그 공간의 온보딩이다', () => {
    expect(authRevisitPath(list, 'ws_02')).toBe('/onboarding/ws_02/connect_notion')
  })

  it('목록에 없는 lastWorkspaceId 는 무시하고 개수로 가른다', () => {
    expect(authRevisitPath(list, 'ws_99')).toBe('/workspaces')
    expect(authRevisitPath([workspace('ws_01')], 'ws_99')).toBe('/workspaces/ws_01/dashboard')
    expect(authRevisitPath([], 'ws_99')).toBe('/onboarding/create_workspace')
  })

  it('lastWorkspaceId 가 없으면 개수로 가른다', () => {
    expect(authRevisitPath(list, null)).toBe('/workspaces')
  })
})

describe('findMemberWorkspace', () => {
  it('목록에 있으면 그 공간이다', () => {
    expect(findMemberWorkspace([workspace('ws_01')], 'ws_01')?.id).toBe('ws_01')
  })

  it('목록에 없으면 null 이다 — role 로 소속을 짐작하지 않는다', () => {
    expect(findMemberWorkspace([workspace('ws_01')], 'ws_02')).toBeNull()
  })

  it('ID 가 없으면 null 이다', () => {
    expect(findMemberWorkspace([workspace('ws_01')], null)).toBeNull()
  })
})

describe('readOnboardingStep', () => {
  it('서버 순서의 네 단계만 받는다', () => {
    expect(ONBOARDING_STEPS).toEqual([
      'create_workspace',
      'connect_discord',
      'connect_notion',
      'connect_members',
    ])
    expect(readOnboardingStep('connect_notion')).toBe('connect_notion')
    expect(readOnboardingStep('bogus')).toBeNull()
    expect(readOnboardingStep(undefined)).toBeNull()
  })
})
