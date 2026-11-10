import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { integrationsQueryOptions } from '@/entities/integration'
import { discordUsersQueryOptions, memberListQueryOptions, pmsOf } from '@/entities/member'
import type { DiscordUser, Member } from '@/entities/member'
import { MemberRows, useMemberRowsBusy } from '@/features/member-mapping'
import { useOnboardingSave } from '@/features/onboarding'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { guardLeave } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { DeferredSkeleton, Reveal } from '@/shared/ui/deferred-skeleton'
import { Skeleton } from '@/shared/ui/skeleton'
import { ExitLink } from './ExitLink'
import { OnboardingCard } from './OnboardingCard'
import { OnboardingLayout } from './OnboardingLayout'
import { STEP_NUMBER, STEP_TITLE } from './stepTitles'
import { useStepNavPaths } from './useStepNavPaths'

const CARD = {
  title: '팀원 연결',
  description: '디스코드 계정과 이름을 이어 두면 마감 하루 전에 DM이 나갑니다.',
} as const

const NOT_CONNECTED =
  '디스코드를 연결하지 않아 팀원을 불러올 수 없어요. 이름으로 팀원을 추가하거나, 이전 단계에서 연결하거나, 건너뛸 수 있어요.'

/** `확인 완료` 는 만든 PM 이 디스코드에 연결돼 있어야 한다 (#228, 2026-10-14 사용자 결정) */
const PM_REQUIRED = 'PM의 디스코드 계정을 골라야 완료할 수 있어요.'

function messagesFor(discordUsers: readonly DiscordUser[], members: readonly Member[]): string[] {
  const accounts = discordUsers.filter(({ isBot }) => !isBot)
  const linked = new Set(members.map(({ discordUserId }) => discordUserId))
  const unknown = accounts.filter(({ discordUserId }) => !linked.has(discordUserId)).length
  return [
    `마지막이에요. 디스코드에서 팀원 ${accounts.length}명을 찾았어요 — 누구인지 확인해 주세요.`,
    ...(unknown > 0
      ? [`${unknown}명은 누구인지 모르겠어요. 매칭하지 않으면 그 사람에게는 DM을 보낼 수 없습니다.`]
      : []),
  ]
}

interface MembersFormProps {
  workspaceId: string
  discordUsers: DiscordUser[]
  notice: string | undefined
  /** `이전 단계` 가 갈 Notion 둘러보기 */
  previous: string | null
  /** 두 목록을 기다린 뒤 나타났다 — 카드 본문과 버튼에 불투명도 전환을 건다. 단계 머리·카드 제목은 기다리는 동안에도 같았다 (#508) */
  reveal: boolean
}

/**
 * 온보딩의 팀원 연결. 목록은 팀원 관리 창과 같은 `MemberRows` 이고 줄마다 바로 저장한다 — 초대는 숨긴다.
 * `N명 확인 완료` 의 N 은 디스코드에 연결된 팀원 수다. 만든 PM 이 연결돼 있어야 하고(#228), 단계 완료만 보낸다.
 * `나중에 하기` 와 하단 `다음 단계` 는 건너뜀을 저장한다. 줄을 쓰거나 단계를 저장하는 동안에는 셋 다와 나가기를 막는다.
 * 열린 이름 고치기 칸에 바꾼 글자가 있으면 나가기·`이전 단계` 와 단계 저장(완료·건너뜀) 모두 공통 이탈 확인을 거친다 —
 * 단계를 저장하면 대시보드로 가서 칸이 사라진다.
 */
function MembersForm({ workspaceId, discordUsers, notice, previous, reveal }: MembersFormProps) {
  const members = useQuery(memberListQueryOptions(workspaceId)).data ?? []
  const writing = useMemberRowsBusy(workspaceId)
  const onboarding = useOnboardingSave(workspaceId)
  const pmAccount = useRef<HTMLButtonElement>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const creator = pmsOf(members)[0]
  const linked = members.filter(({ discordUserId }) => discordUserId !== null).length

  // 카드 버튼과 `›` 가 겹쳐 눌려도 단계 저장은 하나다
  const lock = useRef(false)
  const saveStep = (action: 'complete' | 'skip') =>
    guardLeave(() => {
      if (lock.current) return
      lock.current = true
      setFormError(null)
      void onboarding
        .save({ step: 'connect_members', action })
        .catch((error: unknown) => setFormError(errorMessage(error)))
        .finally(() => {
          lock.current = false
        })
    })
  const complete = () => {
    if (creator?.discordUserId === null) {
      setFormError(PM_REQUIRED)
      pmAccount.current?.focus()
      return
    }
    saveStep('complete')
  }
  const skip = () => saveStep('skip')
  const busy = writing || onboarding.isPending

  return (
    <OnboardingLayout
      stepNumber={STEP_NUMBER.connect_members}
      title={STEP_TITLE.connect_members}
      exit={<ExitLink busy={busy} />}
      notice={notice}
      messages={messagesFor(discordUsers, members)}
      nav={{ previous, onNext: skip, disabled: busy }}
    >
      <OnboardingCard
        title={CARD.title}
        description={CARD.description}
        actions={
          <Reveal indicator={{ reveal }}>
            <Button
              variant="primary"
              size="lg-onboarding"
              loading={onboarding.isPending}
              disabled={linked === 0 || writing}
              onClick={complete}
            >
              {linked}명 확인 완료
            </Button>
            <Button variant="text" size="lg-onboarding" disabled={busy} onClick={skip}>
              나중에 하기
            </Button>
          </Reveal>
        }
      >
        <Reveal indicator={{ reveal }}>
          <FormErrorPanel message={formError} className="mt-6" />
          <MemberRows
            workspaceId={workspaceId}
            discordUsers={discordUsers}
            tone="onboarding"
            pmAccountRef={pmAccount}
          />
        </Reveal>
      </OnboardingCard>
    </OnboardingLayout>
  )
}

interface DiscordNotConnectedProps {
  workspaceId: string
  notice: string | undefined
  previous: string | null
  /** 두 목록을 기다리다 연결이 없다고 알았다 — 카드 본문과 버튼에 불투명도 전환을 건다 (#508) */
  reveal: boolean
}

/**
 * Discord 를 연결하지 않은 채 온 팀원 연결 (D-073 개정, 2026-09-29). 불러올 Discord 사용자가 없다 —
 * 오류 대신 까닭을 알리고, 이름만으로 팀원을 추가·고치게 한다 (#613). 추가한 팀원은 Discord 를 연결한 뒤 팀원 관리에서 잇는다.
 * PM 이 아닌 팀원이 있으면 `다음` 으로 단계 완료를, 없으면 `건너뛰기` 로 건너뜀을 저장한다. 하단 `›` 도 같다.
 * `‹` 로 Notion·Discord 둘러보기에 가서 연결할 수 있다.
 */
function DiscordNotConnected({ workspaceId, notice, previous, reveal }: DiscordNotConnectedProps) {
  const onboarding = useOnboardingSave(workspaceId)
  const writing = useMemberRowsBusy(workspaceId)
  const members = useQuery(memberListQueryOptions(workspaceId))
  const added = members.data?.some(({ role }) => role !== 'pm') ?? false
  const [formError, setFormError] = useState<string | null>(null)
  // 카드 버튼과 `›` 가 겹쳐 눌려도 저장 요청은 하나다
  const lock = useRef(false)
  const next = () =>
    guardLeave(() => {
      if (lock.current) return
      lock.current = true
      setFormError(null)
      void onboarding
        .save({ step: 'connect_members', action: added ? 'complete' : 'skip' })
        .catch((error: unknown) => setFormError(errorMessage(error)))
        .finally(() => {
          lock.current = false
        })
    })
  const busy = onboarding.isPending || writing

  return (
    <OnboardingLayout
      stepNumber={STEP_NUMBER.connect_members}
      title={STEP_TITLE.connect_members}
      exit={<ExitLink busy={busy} />}
      notice={notice}
      messages={['마지막이에요. 디스코드를 연결하면 팀원 이름을 이어 둘 수 있어요.']}
      nav={{ previous, onNext: next, disabled: busy }}
    >
      <OnboardingCard
        title={CARD.title}
        description={CARD.description}
        actions={
          <Reveal indicator={{ reveal }}>
            <Button
              variant="primary"
              size="lg-onboarding"
              loading={onboarding.isPending}
              disabled={writing}
              onClick={next}
            >
              {added ? '다음' : '건너뛰기'}
            </Button>
          </Reveal>
        }
      >
        <Reveal indicator={{ reveal }}>
          <FormErrorPanel message={formError} className="mt-6" />
          <p className="pt-6 text-body text-dim">{NOT_CONNECTED}</p>
          <MemberRows workspaceId={workspaceId} discordUsers={null} tone="onboarding" />
        </Reveal>
      </OnboardingCard>
    </OnboardingLayout>
  )
}

function isNotConnected(error: unknown): boolean {
  return error instanceof ApiError && error.code === ERROR_CODES.INTEGRATION_NOT_CONNECTED
}

export interface MembersStepProps {
  workspaceId: string
}

/**
 * 온보딩 4단계. Discord 사용자와 기존 팀원을 함께 불러온 뒤 팀원 목록을 그린다.
 * Discord 가 연결되지 않았으면(연동 상태로 알거나 409 `INTEGRATION_NOT_CONNECTED`) 건너뛰기 안내를 보인다.
 */
export function MembersStep({ workspaceId }: MembersStepProps) {
  const integrations = useQuery(integrationsQueryOptions(workspaceId))
  const discordStatus = integrations.data?.discord.status
  // 두 조회는 서로 기다리지 않는다 — 같은 렌더에서 함께 시작한다.
  // 연동 상태를 이미 알고 연결이 없으면 Discord 사용자는 부르지 않는다 — 409 가 뻔하다
  const discordUsers = useQuery({
    ...discordUsersQueryOptions(workspaceId),
    enabled: discordStatus === undefined || discordStatus === 'connected',
  })
  const members = useQuery(memberListQueryOptions(workspaceId))
  const notice = integrations.data?.notion.status === 'connected' ? '노션 연동 완료' : undefined
  const { previous } = useStepNavPaths(workspaceId, 'connect_members')
  const notConnected =
    (discordStatus !== undefined && discordStatus !== 'connected') ||
    isNotConnected(discordUsers.error)
  const error = discordUsers.error ?? members.error
  // 두 목록을 받는 중이다. 받은 뒤의 화면(연결 안 됨 · 팀원 잇기)은 단계 머리·카드 제목이 같아 카드 본문과 버튼만 전환한다 (#508)
  const indicator = useLoadingIndicator(
    !notConnected && (discordUsers.data === undefined || members.data === undefined) && !error,
  )

  if (notConnected && !indicator.pending) {
    return (
      <DiscordNotConnected
        workspaceId={workspaceId}
        notice={notice}
        previous={previous}
        reveal={indicator.reveal}
      />
    )
  }

  if (discordUsers.data === undefined || members.data === undefined || indicator.pending) {
    return (
      <OnboardingLayout
        stepNumber={STEP_NUMBER.connect_members}
        title={STEP_TITLE.connect_members}
        exit={<ExitLink />}
        notice={notice}
        messages={['디스코드에서 팀원을 불러오고 있어요.']}
        nav={{ previous }}
      >
        <OnboardingCard title={CARD.title} description={CARD.description}>
          {error && !indicator.pending ? (
            <Reveal indicator={indicator}>
              <QueryErrorState
                error={error}
                onRetry={() => {
                  void discordUsers.refetch()
                  void members.refetch()
                }}
              />
            </Reveal>
          ) : (
            <DeferredSkeleton indicator={indicator} className="pt-6">
              <Skeleton lines={3} />
            </DeferredSkeleton>
          )}
        </OnboardingCard>
      </OnboardingLayout>
    )
  }

  return (
    <MembersForm
      workspaceId={workspaceId}
      discordUsers={discordUsers.data}
      notice={notice}
      previous={previous}
      reveal={indicator.reveal}
    />
  )
}
