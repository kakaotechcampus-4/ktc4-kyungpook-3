import { fallbackValue } from '@/shared/api/unknownValue'
import type { OnboardingDto, WorkspaceDto } from '@/shared/types/api/workspace'
import type { Role } from '@/shared/types/common'
import type { OnboardingProgress, Workspace, WorkspaceSummary } from './types'

/** 모르는 역할은 팀원으로 내린다(보수 폴백). null 은 서버가 허용하는 값이라(팀원 행이 없을 때) 경고하지 않는다 */
function toRole(value: string | null): Role {
  return value === null
    ? 'member'
    : fallbackValue(value, ['pm', 'member'], 'member', 'workspace role')
}

export function toWorkspaceSummary(dto: WorkspaceDto): WorkspaceSummary {
  return {
    id: dto.workspace_id,
    name: dto.name,
    role: toRole(dto.role),
    memberId: dto.member_id ?? null,
    createdAt: dto.created_at,
  }
}
export function toOnboarding(dto: OnboardingDto): OnboardingProgress {
  return {
    completed: dto.completed,
    // 백엔드는 온보딩 완료 시 null 이 아니라 빈 문자열을 준다 (계약 §4.0-②-4). 둘을 같게 다룬다
    currentStep: dto.current_step || null,
    steps: dto.steps,
  }
}
export function toWorkspace(dto: WorkspaceDto): Workspace {
  return { ...toWorkspaceSummary(dto), onboarding: toOnboarding(dto.onboarding) }
}
