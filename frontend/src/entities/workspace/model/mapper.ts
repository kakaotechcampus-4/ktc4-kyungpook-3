import type { OnboardingDto, WorkspaceDto, WorkspaceSummaryDto } from '@/shared/types/api/workspace'
import type { Role } from '@/shared/types/common'
import type {
  OnboardingProgress,
  OnboardingStep,
  OnboardingStepStatus,
  Workspace,
  WorkspaceSummary,
} from './types'
const steps: OnboardingStep[] = [
  'create_workspace',
  'connect_discord',
  'connect_notion',
  'connect_members',
]
const statuses: OnboardingStepStatus[] = ['pending', 'completed', 'skipped']
function warnUnknown(field: string, value: string): void {
  if (import.meta.env.DEV) console.warn(`Unknown ${field}: ${value}`)
}
function safeRole(value: string): Role {
  if (value === 'pm' || value === 'member') return value
  warnUnknown('workspace role', value)
  return 'member'
}
function safeStep(value: string): OnboardingStep | null {
  if (steps.includes(value as OnboardingStep)) return value as OnboardingStep
  warnUnknown('onboarding step', value)
  return null
}
function safeStatus(value: string): OnboardingStepStatus {
  if (statuses.includes(value as OnboardingStepStatus)) return value as OnboardingStepStatus
  warnUnknown('onboarding status', value)
  return 'pending'
}
export function toWorkspaceSummary(dto: WorkspaceSummaryDto): WorkspaceSummary {
  return {
    id: dto.workspace_id,
    name: dto.name,
    role: safeRole(dto.role),
    createdAt: dto.created_at,
  }
}
export function toOnboarding(dto: OnboardingDto): OnboardingProgress {
  return {
    completed: dto.completed,
    currentStep: dto.current_step === null ? null : safeStep(dto.current_step),
    steps: dto.steps.map(({ step, status }) => ({
      step: safeStep(step) ?? 'create_workspace',
      status: safeStatus(status),
    })),
  }
}
export function toWorkspace(dto: WorkspaceDto): Workspace {
  return { ...toWorkspaceSummary(dto), onboarding: toOnboarding(dto.onboarding) }
}
