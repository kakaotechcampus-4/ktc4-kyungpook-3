import { useParams, useSearchParams } from 'react-router'
import { readOnboardingReview, readOnboardingStep, useMemberWorkspace } from '@/entities/workspace'
import { useRouteId } from '@/shared/lib/url'
import { IntegrationStep, MembersStep, ResumeCreateStep, WaitingStep } from '@/widgets/onboarding'

/**
 * 단계 URL 은 RequireValidOnboardingStep 이 이미 서버의 현재 단계(또는 둘러볼 수 있는 지난 단계)로 맞췄다.
 * 미완료 공간의 일반 팀원은 대기 안내만 본다 — 입력도 저장 요청도 없고 하단 화살표도 없다. 설정은 PM 만 바꾼다.
 * 팀원 연결은 마지막 단계라 둘러보기가 없다 — 끝내면 온보딩이 끝난다.
 */
export function OnboardingStepPage() {
  const workspace = useMemberWorkspace(useRouteId('workspaceId'))
  const step = readOnboardingStep(useParams().step)
  const [searchParams] = useSearchParams()
  const review = readOnboardingReview(searchParams)

  if (workspace === null || step === null) return null
  if (workspace.role !== 'pm') return <WaitingStep step={step} />
  switch (step) {
    case 'create_workspace':
      return <ResumeCreateStep workspace={workspace} review={review} />
    case 'connect_discord':
      return (
        <IntegrationStep
          key="discord"
          workspaceId={workspace.id}
          provider="discord"
          review={review}
        />
      )
    case 'connect_notion':
      return (
        <IntegrationStep
          key="notion"
          workspaceId={workspace.id}
          provider="notion"
          review={review}
        />
      )
    case 'connect_members':
      return <MembersStep workspaceId={workspace.id} />
  }
}
