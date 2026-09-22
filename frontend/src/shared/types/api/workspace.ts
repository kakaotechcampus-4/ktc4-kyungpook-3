export interface OnboardingDto {
  completed: boolean
  // 완료 시 백엔드는 null 이 아니라 빈 문자열을 준다 (계약 §4.0-②-4). mapper 가 둘을 같게 다룬다
  current_step: string | null
  steps: { step: string; status: string }[]
}
// 목록과 상세가 같은 모양이다. 백엔드 WorkspaceListResponse.items 가 WorkspaceResponse 다.
// 화면이 요약만 필요하면 매퍼(toWorkspaceSummary)가 좁힌다
export interface WorkspaceSummaryDto {
  workspace_id: string
  name: string
  // 현재 사용자 기준이라 비소속이면 null 이다 (WorkspaceResponse.role 이 Optional).
  // 목록은 소속만 반환하므로 항상 채워지고, 상세에서만 null 이 올 수 있다
  role: string | null
  created_at: string
}
export interface WorkspaceDto extends WorkspaceSummaryDto {
  onboarding: OnboardingDto
}
