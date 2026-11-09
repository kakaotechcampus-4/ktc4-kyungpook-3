import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { integrationsQueryOptions } from '@/entities/integration'
import { discordUsersQueryOptions, memberListQueryOptions, pmsOf } from '@/entities/member'
import type { Member } from '@/entities/member'
import { MemberAddForm } from '@/features/member-add'
import {
  MemberMappingFields,
  buildMappingRows,
  useMemberMappingForm,
} from '@/features/member-mapping'
import type { MappingRow } from '@/features/member-mapping'
import { useOnboardingSave } from '@/features/onboarding'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
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

function messagesFor(rows: readonly MappingRow[]): string[] {
  const unknown = rows.filter(({ name }) => !name.trim()).length
  return [
    `마지막이에요. 디스코드에서 팀원 ${rows.length}명을 찾았어요 — 이름만 확인해 주세요.`,
    ...(unknown > 0
      ? [`${unknown}명은 누구인지 모르겠어요. 매칭하지 않으면 그 사람에게는 DM을 보낼 수 없습니다.`]
      : []),
  ]
}

interface MembersFormProps {
  workspaceId: string
  initialRows: MappingRow[]
  /** PM 팀원. 먼저 만들어진 순서다 — 첫째가 워크스페이스를 만든 PM 이고 체크박스가 그 PM 을 가리킨다 (#228) */
  pms: Member[]
  notice: string | undefined
  /** `이전 단계` 가 갈 Notion 둘러보기 */
  previous: string | null
  /** 두 목록을 기다린 뒤 나타났다 — 카드 본문과 버튼에 불투명도 전환을 건다. 단계 머리·카드 제목은 기다리는 동안에도 같았다 (#508) */
  reveal: boolean
}

/**
 * 온보딩의 팀원 연결 입력. 입력과 저장 규칙은 `useMemberMappingForm` 이 맡는다.
 * `확인 완료` 는 PM 을 체크해야 하고(#228), 모두 저장한 뒤에만 팀원 연결 단계 완료를 보낸다.
 * `나중에 하기`·나가기 저장은 PM 체크를 막지 않는다.
 * 하단 `다음 단계` 는 `나중에 하기` 와 같다(같은 잠금). `이전 단계` 는 공통 이탈 확인을 거친다 — 입력을 저장하지 않는다.
 */
function MembersForm({
  workspaceId,
  initialRows,
  pms,
  notice,
  previous,
  reveal,
}: MembersFormProps) {
  const mapping = useMemberMappingForm(workspaceId, initialRows, pms)
  const {
    form: {
      getValues,
      formState: { isSubmitting, isDirty },
    },
    submit,
    filled,
    setFormError,
    save,
    release,
  } = mapping
  const onboarding = useOnboardingSave(workspaceId)

  /* `확인 완료` · `나중에 하기` · `나가기` 저장은 한 번에 하나다 (F-r1 #7). 둘이 겹치면 같은 팀원 캐시로 계획해
     같은 줄에 POST 가 두 번 나갈 수 있다. 렌더를 기다리지 않고 ref 로 막는다 — 버튼이 비활성이 되기 전의 클릭도 막힌다 */
  const lock = useRef(false)
  const [exiting, setExiting] = useState(false)
  const exclusive = async (work: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    try {
      await work()
    } finally {
      lock.current = false
    }
  }

  /* 제출 handler 는 이벤트 안에서 만든다 — lock 을 쓰는 함수를 렌더 중에 넘기지 않는다 */
  const onSubmit = (event: FormEvent<HTMLFormElement>) =>
    submit((values) =>
      exclusive(async () => {
        if (!(await save(values, true))) return
        await onboarding
          .save({ step: 'connect_members', action: 'complete' })
          .catch((error: unknown) => setFormError(errorMessage(error)))
      }),
    )(event)

  /* 건너뛰기가 저장된 뒤에만 등록을 푼다. 실패하면 입력이 남아 있으니 이탈 확인도 남아야 한다.
     성공하면 단계 가드가 옮기는데, 그 <Navigate> 는 관문을 타지 않아 등록이 남아 있어도 막지 않는다 */
  const skip = () => {
    setFormError(null)
    void exclusive(() =>
      onboarding
        .save({ step: 'connect_members', action: 'skip' })
        .then(() => release())
        .catch((error: unknown) => setFormError(errorMessage(error))),
    )
  }

  /** 나가기 전 저장. 다른 저장이 진행 중이면 나가지 않는다 — 끝난 뒤 다시 누르면 된다 */
  const beforeLeave = async (): Promise<boolean> => {
    if (lock.current) return false
    if (!isDirty) return true
    let ok = false
    setExiting(true)
    await exclusive(async () => {
      ok = await save(getValues())
    })
    setExiting(false)
    return ok
  }

  const busy = isSubmitting || onboarding.isPending || exiting

  return (
    <OnboardingLayout
      stepNumber={STEP_NUMBER.connect_members}
      title={STEP_TITLE.connect_members}
      exit={<ExitLink beforeLeave={beforeLeave} />}
      notice={notice}
      messages={messagesFor(initialRows)}
      nav={{ previous, onNext: skip, disabled: busy }}
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)}>
        <OnboardingCard
          title={CARD.title}
          description={CARD.description}
          actions={
            <Reveal indicator={{ reveal }}>
              <Button
                type="submit"
                variant="primary"
                size="lg-onboarding"
                loading={busy}
                disabled={filled === 0}
              >
                {filled}명 확인 완료
              </Button>
              <Button
                type="button"
                variant="text"
                size="lg-onboarding"
                disabled={busy}
                onClick={skip}
              >
                나중에 하기
              </Button>
            </Reveal>
          }
        >
          <Reveal indicator={{ reveal }}>
            <MemberMappingFields mapping={mapping} />
          </Reveal>
        </OnboardingCard>
      </form>
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
 * 오류 대신 까닭을 알리고, 이름만으로 팀원을 추가하게 한다 (#613). 추가한 팀원은 Discord 를 연결한 뒤 매칭 폼에서 잇는다.
 * PM 이 아닌 팀원이 있으면 `다음` 으로 단계 완료를, 없으면 `건너뛰기` 로 건너뜀을 저장한다. 하단 `›` 도 같다.
 * `‹` 로 Notion·Discord 둘러보기에 가서 연결할 수 있다.
 */
function DiscordNotConnected({ workspaceId, notice, previous, reveal }: DiscordNotConnectedProps) {
  const onboarding = useOnboardingSave(workspaceId)
  const members = useQuery(memberListQueryOptions(workspaceId))
  const added = members.data?.some(({ role }) => role !== 'pm') ?? false
  const [formError, setFormError] = useState<string | null>(null)
  // 카드 버튼과 `›` 가 겹쳐 눌려도 저장 요청은 하나다
  const lock = useRef(false)
  const next = () => {
    if (lock.current) return
    lock.current = true
    setFormError(null)
    void onboarding
      .save({ step: 'connect_members', action: added ? 'complete' : 'skip' })
      .catch((error: unknown) => setFormError(errorMessage(error)))
      .finally(() => {
        lock.current = false
      })
  }
  const busy = onboarding.isPending

  return (
    <OnboardingLayout
      stepNumber={STEP_NUMBER.connect_members}
      title={STEP_TITLE.connect_members}
      exit={<ExitLink />}
      notice={notice}
      messages={['마지막이에요. 디스코드를 연결하면 팀원 이름을 이어 둘 수 있어요.']}
      nav={{ previous, onNext: next, disabled: busy }}
    >
      <OnboardingCard
        title={CARD.title}
        description={CARD.description}
        actions={
          <Reveal indicator={{ reveal }}>
            <Button variant="primary" size="lg-onboarding" loading={busy} onClick={next}>
              {added ? '다음' : '건너뛰기'}
            </Button>
          </Reveal>
        }
      >
        <Reveal indicator={{ reveal }}>
          <FormErrorPanel message={formError} className="mt-6" />
          <p className="pt-6 text-body text-dim">{NOT_CONNECTED}</p>
          <div className="pt-14">
            <MemberAddForm workspaceId={workspaceId} tone="onboarding" />
          </div>
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
 * 온보딩 4단계. Discord 사용자와 기존 팀원을 함께 불러와 `linkDiscordUsers` 로 줄을 만든다.
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
      initialRows={buildMappingRows(discordUsers.data, members.data)}
      pms={pmsOf(members.data)}
      notice={notice}
      previous={previous}
      reveal={indicator.reveal}
    />
  )
}
