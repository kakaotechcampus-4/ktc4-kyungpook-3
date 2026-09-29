import { useParams } from 'react-router'
import { readOnboardingStep, useMemberWorkspace } from '@/entities/workspace'
import { useRouteId } from '@/shared/lib/url'
import { IntegrationStep, MembersStep, ResumeCreateStep, WaitingStep } from '@/widgets/onboarding'

/**
 * 단계 URL 은 RequireValidOnboardingStep 이 이미 서버의 현재 단계로 맞췄다.
 * 미완료 공간의 일반 팀원은 대기 안내만 본다 — 입력도 저장 요청도 없다. 설정은 PM 만 바꾼다.
 */
export function OnboardingStepPage() {
  const workspace = useMemberWorkspace(useRouteId('workspaceId'))
  const step = readOnboardingStep(useParams().step)

  if (workspace === null || step === null) return null
  if (workspace.role !== 'pm') return <WaitingStep step={step} />
  switch (step) {
    case 'create_workspace':
      return <ResumeCreateStep workspace={workspace} />
    case 'connect_discord':
      return <IntegrationStep key="discord" workspaceId={workspace.id} provider="discord" />
    case 'connect_notion':
      return <IntegrationStep key="notion" workspaceId={workspace.id} provider="notion" />
    case 'connect_members':
      return <MembersStep workspaceId={workspace.id} />
  }
}
