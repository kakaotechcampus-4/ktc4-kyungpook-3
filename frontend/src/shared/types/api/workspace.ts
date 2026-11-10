import { z } from 'zod'

/*
 * 워크스페이스 응답 스키마 (backend app/api/workspaces.py·app/schemas/workspace.py, 계약 §4.2). FE 가 읽는 필드만 본다.
 * 타입은 이 스키마에서 만든다 (#348)
 */

/**
 * 온보딩 단계와 그 상태. 가드가 이어 갈 단계와 둘러볼 수 있는 단계를 정해 모르는 값이면 응답 전체가 `INVALID_RESPONSE` 다.
 * 서버 순서 그대로다
 */
export const onboardingStepSchema = z.enum([
  'create_workspace',
  'connect_discord',
  'connect_notion',
  'connect_members',
])
const onboardingStepStatusSchema = z.enum(['pending', 'completed', 'skipped'])

const onboardingSchema = z.object({
  completed: z.boolean(),
  // 완료 시 백엔드는 null 이 아니라 빈 문자열을 준다 (계약 §4.0-②-4). mapper 가 둘을 같게 다룬다
  current_step: z.union([onboardingStepSchema, z.literal('')]).nullable(),
  steps: z.array(z.object({ step: onboardingStepSchema, status: onboardingStepStatusSchema })),
})
export type OnboardingDto = z.infer<typeof onboardingSchema>

/** 목록과 상세가 같은 모양이다. 백엔드 WorkspaceListResponse.items 가 WorkspaceResponse 다 */
export const workspaceSchema = z.object({
  workspace_id: z.string(),
  name: z.string(),
  // 현재 사용자 기준이다(Optional). 소속만 받으므로 지금은 늘 채워진다. 모르는 값은 mapper 가 `member` 로 내린다
  role: z.string().nullable(),
  // role 과 같은 팀원 행. 그 행이 없으면 null 이고, 이 칸을 넣기 전 백엔드는 아예 주지 않는다 (#367)
  member_id: z.string().nullish(),
  created_at: z.string(),
  onboarding: onboardingSchema,
})
export type WorkspaceDto = z.infer<typeof workspaceSchema>

export const workspaceListSchema = z.object({ items: z.array(workspaceSchema) })

/** 요청 본문. 백엔드 WorkspaceCreateRequest 는 name 1~100자다. 1~20자·정규화는 화면이 먼저 본다 (D-015~D-020) */
export interface WorkspaceCreateDto {
  name: string
}
/** 백엔드 WorkspaceOnboardingUpdateRequest. action 은 skip 또는 complete 다 (계약 §4.2) */
export interface OnboardingUpdateDto {
  step: string
  action: 'skip' | 'complete'
}
