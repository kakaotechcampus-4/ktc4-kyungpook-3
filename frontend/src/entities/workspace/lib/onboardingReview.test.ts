import type { OnboardingProgress, OnboardingStepStatus, Workspace } from '../model/types'
import {
  isReviewableStep,
  nextReviewPath,
  previousStepPath,
  readOnboardingReview,
} from './onboardingReview'

type Statuses = [
  OnboardingStepStatus,
  OnboardingStepStatus,
  OnboardingStepStatus,
  OnboardingStepStatus,
]

function progress(statuses: Statuses, currentStep: OnboardingProgress['currentStep'] = null) {
  const steps = (
    ['create_workspace', 'connect_discord', 'connect_notion', 'connect_members'] as const
  ).map((step, index) => ({ step, status: statuses[index] }))
  return { completed: false, currentStep, steps } satisfies OnboardingProgress
}

function workspace(onboarding: OnboardingProgress): Workspace {
  return { id: 'ws_03', name: '팀', role: 'pm', createdAt: '2026-09-01T00:00:00Z', onboarding }
}

/* Notion 단계에서 멈춘 공간. Discord 는 연결했다 */
const AT_NOTION = progress(['completed', 'completed', 'pending', 'pending'], 'connect_notion')

describe('readOnboardingReview', () => {
  it.each([
    ['review=1', true],
    ['review=0', false],
    ['review=true', false],
    ['', false],
  ])('%s → %s', (search, expected) => {
    expect(readOnboardingReview(new URLSearchParams(search))).toBe(expected)
  })
})

describe('isReviewableStep', () => {
  it('이어 갈 단계보다 앞이고 완료·건너뜀이면 둘러볼 수 있다', () => {
    expect(isReviewableStep(AT_NOTION, 'create_workspace')).toBe(true)
    expect(isReviewableStep(AT_NOTION, 'connect_discord')).toBe(true)
    const skipped = progress(['completed', 'skipped', 'pending', 'skipped'], 'connect_notion')
    expect(isReviewableStep(skipped, 'connect_discord')).toBe(true)
  })

  it('이어 갈 단계와 그 뒤는 둘러볼 수 없다', () => {
    expect(isReviewableStep(AT_NOTION, 'connect_notion')).toBe(false)
    expect(isReviewableStep(AT_NOTION, 'connect_members')).toBe(false)
    // 건너뜀으로 저장됐어도 이어 갈 단계 뒤면 안 된다
    const skipped = progress(['completed', 'skipped', 'pending', 'skipped'], 'connect_notion')
    expect(isReviewableStep(skipped, 'connect_members')).toBe(false)
  })

  it('앞이어도 pending 이면 둘러볼 수 없다', () => {
    const odd = progress(['completed', 'pending', 'pending', 'pending'], 'connect_notion')
    expect(isReviewableStep(odd, 'connect_discord')).toBe(false)
  })
})

describe('previousStepPath', () => {
  it('바로 앞 단계의 둘러보기 경로다', () => {
    expect(previousStepPath(workspace(AT_NOTION), 'connect_notion')).toBe(
      '/onboarding/ws_03/connect_discord?review=1',
    )
    expect(previousStepPath(workspace(AT_NOTION), 'connect_discord')).toBe(
      '/onboarding/ws_03/create_workspace?review=1',
    )
  })

  it('1단계에는 없다', () => {
    expect(previousStepPath(workspace(AT_NOTION), 'create_workspace')).toBeNull()
  })

  it('앞 단계를 둘러볼 수 없으면 없다', () => {
    const resume = progress(['pending', 'pending', 'pending', 'pending'], 'create_workspace')
    expect(previousStepPath(workspace(resume), 'connect_discord')).toBeNull()
  })
})

describe('nextReviewPath', () => {
  it('다음 단계도 지난 단계면 그 둘러보기다', () => {
    expect(nextReviewPath(workspace(AT_NOTION), 'create_workspace')).toBe(
      '/onboarding/ws_03/connect_discord?review=1',
    )
  })

  it('다음 단계가 이어 갈 단계면 둘러보기 표시 없는 보통 경로다', () => {
    expect(nextReviewPath(workspace(AT_NOTION), 'connect_discord')).toBe(
      '/onboarding/ws_03/connect_notion',
    )
  })

  it('마지막 단계 뒤는 이어 갈 단계다', () => {
    const atMembers = progress(
      ['completed', 'completed', 'completed', 'pending'],
      'connect_members',
    )
    expect(nextReviewPath(workspace(atMembers), 'connect_members')).toBe(
      '/onboarding/ws_03/connect_members',
    )
  })
})
