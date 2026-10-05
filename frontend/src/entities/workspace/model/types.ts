import type { Role } from '@/shared/types/common'
export type OnboardingStep =
  'create_workspace' | 'connect_discord' | 'connect_notion' | 'connect_members'
export type OnboardingStepStatus = 'pending' | 'completed' | 'skipped'
export interface OnboardingProgress {
  completed: boolean
  currentStep: OnboardingStep | null
  steps: { step: OnboardingStep; status: OnboardingStepStatus }[]
}
export interface WorkspaceSummary {
  id: string
  name: string
  role: Role
  createdAt: string
}
export interface Workspace extends WorkspaceSummary {
  onboarding: OnboardingProgress
}
/** 워크스페이스 생성 요청. 이름은 화면이 정규화·검증한 값이다 (D-015~D-020) */
export interface CreateWorkspaceInput {
  name: string
}
export type OnboardingAction = 'complete' | 'skip'
/** 온보딩 한 단계 갱신 요청 `{ step, action }` (계약 §4.2) */
export interface OnboardingUpdate {
  step: OnboardingStep
  action: OnboardingAction
}
