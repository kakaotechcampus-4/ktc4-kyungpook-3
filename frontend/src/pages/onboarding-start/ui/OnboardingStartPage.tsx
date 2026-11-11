import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { MyInvitations, UserMenu } from '@/widgets/app-shell'
import { ExitLink, OnboardingCard, OnboardingLayout } from '@/widgets/onboarding'

type StartIntent = 'create' | 'join'

const OPTIONS: Record<StartIntent, { to: string; title: string; description: string }> = {
  join: {
    to: paths.onboardingMember(),
    title: '팀원으로 시작',
    description: '현재 소속된 팀을 확인하고 들어가요.',
  },
  create: {
    to: paths.onboardingCreate(),
    title: 'PM으로 팀 만들기',
    description: '새 워크스페이스를 만들고 팀 설정을 시작해요.',
  },
}

export function OnboardingStartPage() {
  return (
    <OnboardingLayout
      title="어떻게 시작할까요?"
      exit={<ExitLink />}
      accountMenu={<UserMenu />}
      messages={[
        '반가워요! 매스와 함께 시작해 볼까요?',
        '팀원은 소속된 팀에 들어가고, PM은 새 팀을 만들 수 있어요.',
      ]}
    >
      <OnboardingCard
        title="시작 방식 선택"
        description="함께할 팀에 맞는 시작 방식을 선택해 주세요."
      >
        <div className="flex flex-col gap-12 pt-8">
          <MyInvitations />
          <div className="flex gap-12 max-sm:flex-col">
            {Object.entries(OPTIONS).map(([intent, option]) => (
              <GuardedLink
                key={intent}
                to={option.to}
                className="flex min-w-0 flex-1 flex-col gap-8 rounded-10 border border-line bg-surface px-18 py-13 hover:bg-surface-selected"
              >
                <span className="text-body font-semibold">{option.title}</span>
                <span className="text-body text-sub">{option.description}</span>
              </GuardedLink>
            ))}
          </div>
        </div>
      </OnboardingCard>
    </OnboardingLayout>
  )
}
