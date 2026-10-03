import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { z } from 'zod'
import { integrationsQueryOptions } from '@/entities/integration'
import { discordUsersQueryOptions, memberListQueryOptions } from '@/entities/member'
import type { Member } from '@/entities/member'
import {
  MappingSaveError,
  buildMappingRows,
  findMappingIssues,
  saveMemberMappings,
  useOnboardingSave,
} from '@/features/onboarding'
import type { MappingIssue, MappingRow } from '@/features/onboarding'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { useAppForm } from '@/shared/lib/form'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { TextField } from '@/shared/ui/text-field'
import { ExitLink } from './ExitLink'
import { OnboardingCard } from './OnboardingCard'
import { OnboardingLayout } from './OnboardingLayout'
import { STEP_NUMBER, STEP_TITLE } from './stepTitles'
import { useStepNavPaths } from './useStepNavPaths'

const CARD = {
  title: '팀원 연결',
  description: '디스코드 계정과 이름을 이어 두면 마감 하루 전에 DM이 나갑니다.',
} as const

const ISSUE_MESSAGES: Record<MappingIssue, string> = {
  duplicated: '같은 팀원 이름을 두 줄에 쓸 수 없어요.',
  taken: '이미 다른 Discord 계정과 연결된 팀원이에요.',
}

const PARTIAL_FAILURE = '일부 팀원을 저장하지 못했어요. 남은 줄만 다시 저장해요.'

const NOT_CONNECTED =
  '디스코드를 연결하지 않아 팀원을 불러올 수 없어요. 이전 단계에서 연결하거나 건너뛸 수 있어요.'

const ROW = 'flex items-start gap-10 border-b border-surface-selected py-10 last:border-b-0'

const HANDLE = 'min-w-[0px] flex-1 truncate pt-12 text-caption text-dim tabular-nums'

const schema = z.object({
  rows: z.array(z.object({ discordUserId: z.string(), username: z.string(), name: z.string() })),
})

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
  notice: string | undefined
  /** `이전 단계` 가 갈 Notion 둘러보기 */
  previous: string | null
}

/**
 * 팀원 연결 입력. 한 줄이 Discord 사용자 한 명이고 옆에 실제 팀원 이름을 적는다 (D-026).
 * 빈 줄은 저장하지 않는다 — 일부만 적어도 저장하고 끝낼 수 있다 (D-029). 같은 이름은 두 줄에 못 쓴다 (D-027).
 * 저장은 줄마다 순서대로다. 일부가 실패하면 실패한 줄에 오류를 두고 입력은 그대로 남긴다.
 * 모두 저장한 뒤에만 팀원 연결 단계 완료를 보낸다.
 * 하단 `다음 단계` 는 `나중에 하기` 와 같다(같은 잠금). `이전 단계` 는 공통 이탈 확인을 거친다 — 입력을 저장하지 않는다.
 */
function MembersForm({ workspaceId, initialRows, notice, previous }: MembersFormProps) {
  const queryClient = useQueryClient()
  const { form, submit } = useAppForm(schema, { rows: initialRows })
  const {
    register,
    setError,
    clearErrors,
    reset,
    getValues,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = form
  const unsaved = useUnsavedChanges(isDirty)
  const onboarding = useOnboardingSave(workspaceId)
  const [formError, setFormError] = useState<string | null>(null)
  const rows = watch('rows')
  const filled = rows.filter(({ name }) => name.trim()).length

  const members = (): Member[] =>
    queryClient.getQueryData<Member[]>(memberListQueryOptions(workspaceId).queryKey) ?? []

  /** 입력 중 매핑을 저장한다. 성공하면 true — 저장한 값이 새 기준이라 더 묻지 않는다 */
  const saveMappings = async (values: { rows: MappingRow[] }): Promise<boolean> => {
    setFormError(null)
    clearErrors()
    const issues = findMappingIssues(values.rows, members())
    if (issues.size > 0) {
      let first = true
      for (const [index, issue] of issues) {
        setError(
          `rows.${index}.name`,
          { type: 'mapping', message: ISSUE_MESSAGES[issue] },
          { shouldFocus: first },
        )
        first = false
      }
      return false
    }
    try {
      await saveMemberMappings(queryClient, workspaceId, values.rows)
    } catch (error) {
      if (error instanceof MappingSaveError) {
        setError(
          `rows.${error.rowIndex}.name`,
          { type: 'server', message: errorMessage(error.cause) },
          { shouldFocus: true },
        )
        setFormError(PARTIAL_FAILURE)
      } else {
        setFormError(errorMessage(error))
      }
      return false
    }
    reset(values)
    unsaved.release()
    return true
  }

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
        if (!(await saveMappings(values))) return
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
        .then(() => unsaved.release())
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
      ok = await saveMappings(getValues())
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
            <>
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
            </>
          }
        >
          <FormErrorPanel message={formError} className="mt-6" />
          {initialRows.length === 0 ? (
            <p className="pt-6 text-body text-dim">디스코드 서버에서 팀원을 찾지 못했어요.</p>
          ) : (
            <ul className="pt-6">
              {initialRows.map((row, index) => (
                <li key={row.discordUserId} className={ROW}>
                  <span className={HANDLE}>@{row.username}</span>
                  <Icon name="arrow-right" size={12} className="mt-15 shrink-0 text-dashed" />
                  <TextField
                    tone="onboarding"
                    className="flex-1"
                    aria-label={`@${row.username}의 팀원 이름`}
                    placeholder="누구인가요?"
                    error={errors.rows?.[index]?.name?.message}
                    {...register(`rows.${index}.name`)}
                  />
                </li>
              ))}
            </ul>
          )}
        </OnboardingCard>
      </form>
    </OnboardingLayout>
  )
}

interface DiscordNotConnectedProps {
  workspaceId: string
  notice: string | undefined
  previous: string | null
}

/**
 * Discord 를 연결하지 않은 채 온 팀원 연결 (D-073 개정, 2026-09-29). 불러올 Discord 사용자가 없다 —
 * 오류 대신 까닭을 알리고 `건너뛰기` 만 둔다. 저장은 `나중에 하기` 와 같다. `‹` 로 Notion·Discord 둘러보기에 가서 연결할 수 있다.
 */
function DiscordNotConnected({ workspaceId, notice, previous }: DiscordNotConnectedProps) {
  const onboarding = useOnboardingSave(workspaceId)
  const [formError, setFormError] = useState<string | null>(null)
  // 카드 버튼과 `›` 가 겹쳐 눌려도 건너뛰기 요청은 하나다
  const lock = useRef(false)
  const skip = () => {
    if (lock.current) return
    lock.current = true
    setFormError(null)
    void onboarding
      .save({ step: 'connect_members', action: 'skip' })
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
      nav={{ previous, onNext: skip, disabled: busy }}
    >
      <OnboardingCard
        title={CARD.title}
        description={CARD.description}
        actions={
          <Button variant="primary" size="lg-onboarding" loading={busy} onClick={skip}>
            건너뛰기
          </Button>
        }
      >
        <FormErrorPanel message={formError} className="mt-6" />
        <p className="pt-6 text-body text-dim">{NOT_CONNECTED}</p>
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

  if (
    (discordStatus !== undefined && discordStatus !== 'connected') ||
    isNotConnected(discordUsers.error)
  ) {
    return <DiscordNotConnected workspaceId={workspaceId} notice={notice} previous={previous} />
  }

  if (discordUsers.data === undefined || members.data === undefined) {
    const error = discordUsers.error ?? members.error
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
          {error ? (
            <QueryErrorState
              error={error}
              onRetry={() => {
                void discordUsers.refetch()
                void members.refetch()
              }}
            />
          ) : (
            <div aria-busy="true" className="pt-6">
              <Skeleton lines={3} />
            </div>
          )}
        </OnboardingCard>
      </OnboardingLayout>
    )
  }

  return (
    <MembersForm
      workspaceId={workspaceId}
      initialRows={buildMappingRows(discordUsers.data, members.data)}
      notice={notice}
      previous={previous}
    />
  )
}
