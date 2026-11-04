import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Icon } from '@/shared/ui/icon'
import { UserMenu, WorkspaceChoiceList } from '@/widgets/app-shell'
import { OnboardingCard, OnboardingLayout } from '@/widgets/onboarding'

export function OnboardingMemberPage() {
  return (
    <OnboardingLayout
      title="내 팀 확인"
      exit={
        <GuardedLink
          to={paths.onboardingStart()}
          aria-label="시작 방식 다시 선택"
          className="inline-flex h-36 w-36 items-center justify-center rounded-9 text-sub hover:bg-control"
        >
          <Icon name="arrow-left" size={18} />
        </GuardedLink>
      }
      accountMenu={<UserMenu />}
      messages={['이 계정이 현재 소속된 워크스페이스를 확인해요.']}
    >
      <OnboardingCard title="소속 팀 확인" description="함께할 워크스페이스를 선택해 주세요.">
        <WorkspaceChoiceList showCreate={false} variant="onboarding" />
      </OnboardingCard>
    </OnboardingLayout>
  )
}
