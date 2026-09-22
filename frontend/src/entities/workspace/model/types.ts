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
