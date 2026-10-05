import { ONBOARDING_REVIEW_PARAM, paths } from '@/shared/config/routes'
import { ONBOARDING_STEPS } from '../model/onboardingSteps'
import type { OnboardingProgress, OnboardingStep, Workspace } from '../model/types'
import { onboardingResumePath, resumeStep } from './entryPath'

/*
 * 지난 단계 둘러보기 (docs/impl-decision/2026-09-28-onboarding-layout.md, 2026-09-29).
 * `이전 단계` 화살표는 저장된 지난 단계를 `?review=1` 로 보여 주고, 둘러보기의 `다음 단계` 는 요청 없이 한 칸 앞으로 간다.
 * 이어 갈 단계에 닿으면 둘러보기 표시 없는 보통 경로다 — 그 뒤 저장은 지금처럼 단계 가드가 옮긴다.
 */

/** 주소가 둘러보기인가 */
export function readOnboardingReview(params: URLSearchParams): boolean {
  return params.get(ONBOARDING_REVIEW_PARAM) === '1'
}

function statusOf(onboarding: OnboardingProgress, step: OnboardingStep) {
  return onboarding.steps.find((item) => item.step === step)?.status ?? 'pending'
}

/** 둘러볼 수 있는 단계 — 이어 갈 단계보다 앞이고 저장돼 있다(완료·건너뜀) */
export function isReviewableStep(onboarding: OnboardingProgress, step: OnboardingStep): boolean {
  return (
    ONBOARDING_STEPS.indexOf(step) < ONBOARDING_STEPS.indexOf(resumeStep(onboarding)) &&
    statusOf(onboarding, step) !== 'pending'
  )
}

/** `이전 단계` 가 갈 곳 — 바로 앞 단계의 둘러보기. 1단계이거나 앞 단계를 둘러볼 수 없으면 null(화살표 비활성) */
export function previousStepPath(workspace: Workspace, step: OnboardingStep): string | null {
  const previous = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) - 1]
  if (previous === undefined || !isReviewableStep(workspace.onboarding, previous)) return null
  return paths.onboardingReview(workspace.id, previous)
}

/** 둘러보기의 `다음 단계` 가 갈 곳 — 다음 단계도 지난 단계면 그 둘러보기, 아니면 이어 갈 단계 */
export function nextReviewPath(workspace: Workspace, step: OnboardingStep): string {
  const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1]
  if (next !== undefined && isReviewableStep(workspace.onboarding, next)) {
    return paths.onboardingReview(workspace.id, next)
  }
  return onboardingResumePath(workspace)
}
