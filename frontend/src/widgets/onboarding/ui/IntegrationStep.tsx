import type { IntegrationProvider } from '@/entities/integration'
import { useIntegrationStep } from '@/features/onboarding'
import type { IntegrationNotice } from '@/features/onboarding'
import { errorMessage } from '@/shared/api/errorMessages'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { ExitLink } from './ExitLink'
import { OnboardingCard } from './OnboardingCard'
import { OnboardingLayout } from './OnboardingLayout'
import { STEP_NUMBER, STEP_TITLE } from './stepTitles'

/* SetupDiscord·SetupNotion 캔버스 문구. Notion 의 데이터베이스 선택·속성 매핑 블록과 그 말풍선은
   D-154(데이터베이스 선택 화면 없음)에 따라 옮기지 않는다 — docs/impl-decision/2026-09-28-onboarding-layout.md */
const COPY = {
  discord: {
    step: 'connect_discord',
    messages: [
      '안녕하세요! 회의록 정리부터 마감 리마인드까지, 제가 도와드릴게요.',
      '시작하기 전에 몇 가지만 연결할게요. 먼저 디스코드부터 연결해주세요.',
    ],
    title: '디스코드 연동',
    description: '팀 채널에 마감 리마인드와 회의록 요약을 자동으로 보내드려요.',
  },
  notion: {
    step: 'connect_notion',
    messages: ['좋아요, 이제 노션 보드를 연결할게요. 쓰던 데이터베이스를 그대로 쓰면 됩니다.'],
    title: '노션 연동',
    description: '승인한 태스크만 이 데이터베이스에 채워 넣어요. 새 보드는 만들지 않습니다.',
  },
} as const

const NOTICE: Record<IntegrationNotice, string> = {
  cancelled: '연결을 취소했어요. 다시 연결하거나 건너뛸 수 있어요.',
  failed: '연결하지 못했어요. 다시 시도하거나 건너뛸 수 있어요.',
}

const CONNECTED = 'pt-6 text-body font-semibold text-ink'

export interface IntegrationStepProps {
  workspaceId: string
  provider: IntegrationProvider
}

/**
 * 온보딩 2·3단계. `연결하기` 는 현재 탭을 OAuth 로 옮기고, 돌아오면 연동 상태를 다시 조회해
 * `connected` 일 때만 단계를 완료한다. 취소·실패면 안내를 보이고 단계는 그대로다.
 * 이미 연결돼 있는데 단계 저장만 못 했다면 `다음` 이 저장만 다시 한다.
 */
export function IntegrationStep({ workspaceId, provider }: IntegrationStepProps) {
  const copy = COPY[provider]
  const flow = useIntegrationStep(workspaceId, provider)
  // 앞 단계 연동이 끝났으면 말풍선 위에 한 줄 알린다. display_name 은 생성 문자열이라 쓰지 않는다 (계약 §4.0-②-7)
  const notice =
    provider === 'notion' && flow.integrations?.discord.status === 'connected'
      ? '디스코드 연동 완료'
      : undefined
  const connected = flow.integration?.status === 'connected'
  const busy = flow.saving || flow.verifying
  const failure = flow.notice
    ? NOTICE[flow.notice]
    : flow.saveError
      ? errorMessage(flow.saveError)
      : null

  return (
    <OnboardingLayout
      stepNumber={STEP_NUMBER[copy.step]}
      title={STEP_TITLE[copy.step]}
      exit={<ExitLink />}
      notice={notice}
      messages={copy.messages}
    >
      <OnboardingCard
        title={copy.title}
        description={copy.description}
        actions={
          flow.integration === null ? null : (
            <>
              {connected ? (
                <Button
                  variant="primary"
                  size="lg-onboarding"
                  loading={busy}
                  onClick={() => void flow.complete()}
                >
                  다음
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="lg-onboarding"
                  disabled={busy || flow.connectBlocked}
                  onClick={flow.connect}
                >
                  연결하기
                </Button>
              )}
              {connected ? null : (
                <Button
                  variant="text"
                  size="lg-onboarding"
                  disabled={busy}
                  onClick={() => void flow.skip()}
                >
                  건너뛰기
                </Button>
              )}
            </>
          )
        }
      >
        <FormErrorPanel message={failure} className="mt-6" />
        {flow.integration === null && flow.integrationsError ? (
          <QueryErrorState error={flow.integrationsError} onRetry={flow.retryIntegrations} />
        ) : null}
        {connected ? <p className={CONNECTED}>연결됨</p> : null}
        {flow.verifying ? (
          <p role="status" className="pt-6 text-body text-dim">
            연결을 확인하고 있어요.
          </p>
        ) : null}
      </OnboardingCard>
    </OnboardingLayout>
  )
}
