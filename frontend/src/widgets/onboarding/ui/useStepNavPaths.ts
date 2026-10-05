import { nextReviewPath, previousStepPath, useMemberWorkspace } from '@/entities/workspace'
import type { OnboardingStep } from '@/entities/workspace'

export interface StepNavPaths {
  /** `이전 단계` 가 갈 지난 단계 둘러보기. 1단계이거나 공간을 아직 모르면 null */
  previous: string | null
  /** 둘러보기의 `다음 단계` 가 갈 곳. 공간을 아직 모르면 null */
  reviewNext: string | null
}

/** 이 단계의 `이전 단계` · 둘러보기 `다음 단계` 경로. 가드와 같은 목록 캐시로 푼다 */
export function useStepNavPaths(workspaceId: string, step: OnboardingStep): StepNavPaths {
  const workspace = useMemberWorkspace(workspaceId)
  if (workspace === null) return { previous: null, reviewNext: null }
  return {
    previous: previousStepPath(workspace, step),
    reviewNext: nextReviewPath(workspace, step),
  }
}
