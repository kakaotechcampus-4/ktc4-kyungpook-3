import { useParams } from 'react-router'
import { readOnboardingStep, useMemberWorkspace } from '@/entities/workspace'
import type { OnboardingStep } from '@/entities/workspace'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { useRouteId } from '@/shared/lib/url'
import { PagePlaceholder } from '@/shared/ui/page-placeholder'

const STEP_LABEL: Record<OnboardingStep, string> = {
  create_workspace: '워크스페이스 만들기',
  connect_discord: 'Discord 연결',
  connect_notion: 'Notion 연결',
  connect_members: '팀원 연결',
}

const LINK = 'text-body font-semibold text-ink underline'

/**
 * 단계 URL 은 RequireValidOnboardingStep 이 이미 고쳤다.
 * 미완료 공간의 일반 팀원은 대기 안내만 본다 — 입력도 저장 요청도 없다. 설정은 PM 만 바꾼다.
 */
export function OnboardingStepPage() {
  const workspace = useMemberWorkspace(useRouteId('workspaceId'))
  const step = readOnboardingStep(useParams().step)

  if (workspace === null || step === null) return null
  if (workspace.onboarding.completed) {
    return (
      <PagePlaceholder
        title="설정을 마친 워크스페이스예요"
        description="대시보드에서 이어서 이용해 주세요."
      >
        <GuardedLink to={paths.dashboard(workspace.id)} className={LINK}>
          대시보드로
        </GuardedLink>
      </PagePlaceholder>
    )
  }
  if (workspace.role !== 'pm') {
    return (
      <PagePlaceholder
        title="PM이 워크스페이스 설정을 마무리하고 있어요"
        description="설정이 끝나면 이 워크스페이스를 이용할 수 있어요. 설정은 PM만 바꿀 수 있어요."
      />
    )
  }
  return (
    <PagePlaceholder title={STEP_LABEL[step]} description="온보딩 단계 화면은 M4에서 만들어요." />
  )
}
