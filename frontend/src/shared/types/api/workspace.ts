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
  // 현재 사용자 기준이다 (WorkspaceResponse.role 이 Optional). 목록·상세 모두 소속만 받으므로
  // 지금은 늘 채워진다 — 상세도 비소속에게 403 이다(require_member). 타입은 스키마대로 null 을 남긴다
  role: string | null
  created_at: string
}
export interface WorkspaceDto extends WorkspaceSummaryDto {
  onboarding: OnboardingDto
}
// 요청 본문. 백엔드 WorkspaceCreateRequest 는 name 1~100자다. 1~20자·정규화는 화면이 먼저 본다 (D-015~D-020)
export interface WorkspaceCreateDto {
  name: string
}
// 백엔드 WorkspaceOnboardingUpdateRequest. action 은 skip 또는 complete 다 (계약 §4.2)
export interface OnboardingUpdateDto {
  step: string
  action: 'skip' | 'complete'
}
