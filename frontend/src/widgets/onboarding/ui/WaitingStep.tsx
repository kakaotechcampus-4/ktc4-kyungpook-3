import type { OnboardingStep } from '@/entities/workspace'
import { ExitLink } from './ExitLink'
import { OnboardingCard } from './OnboardingCard'
import { OnboardingLayout } from './OnboardingLayout'
import { STEP_NUMBER, STEP_TITLE } from './stepTitles'

export interface WaitingStepProps {
  step: OnboardingStep
}

/**
 * 미완료 공간의 일반 팀원. 설정은 PM 만 바꾼다 — 입력도 버튼도 없고 온보딩 요청을 보내지 않는다.
 * 나가기 화살표(링크)만 있다.
 */
export function WaitingStep({ step }: WaitingStepProps) {
  return (
    <OnboardingLayout
      stepNumber={STEP_NUMBER[step]}
      title={STEP_TITLE[step]}
      exit={<ExitLink />}
      messages={['설정이 끝날 때까지 조금만 기다려 주세요.']}
    >
      <OnboardingCard
        title="PM이 워크스페이스 설정을 마무리하고 있어요"
        description="설정이 끝나면 이 워크스페이스를 이용할 수 있어요. 설정은 PM만 바꿀 수 있어요."
      />
    </OnboardingLayout>
  )
}
