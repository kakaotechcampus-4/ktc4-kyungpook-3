export interface OnboardingDto {
  completed: boolean
  // 완료 시 백엔드는 null 이 아니라 빈 문자열을 준다 (계약 §4.0-②-4). mapper 가 둘을 같게 다룬다
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
