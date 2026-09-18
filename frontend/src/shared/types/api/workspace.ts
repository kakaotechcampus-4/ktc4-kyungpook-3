export interface OnboardingDto {
  completed: boolean
  current_step: string | null
  steps: { step: string; status: string }[]
}
export interface WorkspaceSummaryDto {
  workspace_id: string
  name: string
  role: string
  created_at: string
}
export interface WorkspaceDto extends WorkspaceSummaryDto {
  onboarding: OnboardingDto
}
