import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useController } from 'react-hook-form'
import type { Control } from 'react-hook-form'
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
import { Checkbox } from '@/shared/ui/checkbox'
import { ErrorText } from '@/shared/ui/error-text'
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
  pmDuplicated: '같은 PM을 두 줄에서 체크할 수 없어요.',
  pmClaimed: '다른 줄에서 PM으로 체크한 팀원 이름이에요.',
}

/** PM 체크에 다는 사유. 나머지는 이름 칸에 단다 */
const PM_ISSUES: ReadonlySet<MappingIssue> = new Set(['pmDuplicated'])

const PARTIAL_FAILURE = '일부 팀원을 저장하지 못했어요. 남은 줄만 다시 저장해요.'

/** `확인 완료` 는 PM 을 체크해야 한다 (#228, 2026-10-14 사용자 결정). `나중에 하기`·나가기 저장은 막지 않는다 */
const PM_REQUIRED = 'PM의 디스코드 계정을 체크해야 완료할 수 있어요.'

const NOT_CONNECTED =
  '디스코드를 연결하지 않아 팀원을 불러올 수 없어요. 이전 단계에서 연결하거나 건너뛸 수 있어요.'

const ROW = 'flex items-start gap-10 border-b border-surface-selected py-10 last:border-b-0'

/* 아이디와 PM 라벨의 한 줄. 아이디만 말줄임하고 라벨은 잘리지 않는다 */
const HANDLE = 'flex min-w-[0px] flex-1 items-center gap-6 pt-12'

const HANDLE_TEXT = 'min-w-[0px] truncate text-caption text-dim tabular-nums'

/* PM 을 체크한 줄의 라벨. 회의록 상태 배지(MeetingMinutes STATUS_BADGE)와 같은 모양이다 */
const PM_LABEL =
  'inline-flex h-18 shrink-0 items-center rounded-6 bg-control px-6 text-[10.5px] leading-none font-semibold text-sub'

const FIELDS = 'flex min-w-[0px] flex-1 flex-col gap-6'

/* 줄 맨 앞의 PM 체크. 체크 칸(18px)의 가운데를 이름 칸(42px)의 가운데에 맞춘다 — 9 + 체크 줄 위 여백 3 + 9 = 21 */
const PM_CHECK = 'shrink-0 pt-9'

/** PM 의 디스코드 계정을 골라 체크해 달라고 목록 위에 한 줄로 알린다 */
const PM_HINT = 'pt-6 text-caption text-dim'

const schema = z.object({
  rows: z.array(
    z.object({
      discordUserId: z.string(),
      username: z.string(),
      name: z.string(),
      pmMemberId: z.string().nullable(),
    }),
  ),
})

type FormValues = z.infer<typeof schema>

type FormRow = FormValues['rows'][number]

/** 체크한 PM 이 있거나 이름을 적은 줄. 저장할 줄이다 */
const isFilled = ({ name, pmMemberId }: FormRow) => pmMemberId !== null || name.trim() !== ''

function messagesFor(rows: readonly MappingRow[]): string[] {
  const unknown = rows.filter(({ name }) => !name.trim()).length
  return [
    `마지막이에요. 디스코드에서 팀원 ${rows.length}명을 찾았어요 — 이름만 확인해 주세요.`,
    ...(unknown > 0
      ? [`${unknown}명은 누구인지 모르겠어요. 매칭하지 않으면 그 사람에게는 DM을 보낼 수 없습니다.`]
      : []),
  ]
}

interface PmCheckProps {
  control: Control<FormValues>
  index: number
  username: string
  /** 체크하면 이을 PM. 워크스페이스를 만든 PM 이다 */
  pm: Member
  /** 다른 줄에서 이미 그 PM 을 체크했다. 이 줄에서는 체크할 수 없다 */
  takenElsewhere: boolean
  errorId: string | undefined
}

/**
 * 이 Discord 사용자가 PM 인지 체크한다 (#228). 체크하면 그 PM 의 id 가 이 줄의 값이 되고, 풀면 null 이다.
 * 오류 문구는 이름 칸 아래에 있다 — `errorId` 로 잇는다
 */
function PmCheck({ control, index, username, pm, takenElsewhere, errorId }: PmCheckProps) {
  const {
    field: { ref, value, onChange, onBlur },
  } = useController({ control, name: `rows.${index}.pmMemberId` })
  const checked = value !== null
  return (
    <div className={PM_CHECK}>
      <Checkbox
        ref={ref}
        checked={checked}
        disabled={!checked && takenElsewhere}
        aria-label={`@${username} — PM ${pm.displayName}`}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        onCheckedChange={(next) => onChange(next === true ? pm.id : null)}
        onBlur={onBlur}
      />
    </div>
  )
}

interface MembersFormProps {
  workspaceId: string
  initialRows: MappingRow[]
  /** PM 팀원. 먼저 만들어진 순서다 — 첫째가 워크스페이스를 만든 PM 이고 체크박스가 그 PM 을 가리킨다 (#228) */
  pms: Member[]
  notice: string | undefined
  /** `이전 단계` 가 갈 Notion 둘러보기 */
  previous: string | null
}

/**
 * 팀원 연결 입력. 한 줄이 Discord 사용자 한 명이고 옆에 실제 팀원 이름을 적는다 (D-026).
 * 빈 줄은 저장하지 않는다 — 일부만 적어도 저장하고 끝낼 수 있다 (D-029). 같은 이름은 두 줄에 못 쓴다 (D-027).
 * 줄 맨 앞에서 PM 인지 체크한다 — 체크하면 이름 대신 기존 PM 에 잇고 이름 칸은 PM 이름으로 잠근다 (#228).
 * 저장은 줄마다 순서대로다. 일부가 실패하면 실패한 줄에 오류를 두고 입력은 그대로 남긴다.
 * 모두 저장한 뒤에만 팀원 연결 단계 완료를 보낸다.
 * 하단 `다음 단계` 는 `나중에 하기` 와 같다(같은 잠금). `이전 단계` 는 공통 이탈 확인을 거친다 — 입력을 저장하지 않는다.
 */
function MembersForm({ workspaceId, initialRows, pms, notice, previous }: MembersFormProps) {
  const queryClient = useQueryClient()
  const { form, submit } = useAppForm(schema, {
    rows: initialRows.map((row) => ({ ...row, pmMemberId: row.pmMemberId ?? null })),
  })
  const {
    register,
    setError,
    clearErrors,
    setFocus,
    control,
    reset,
    getValues,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = form
  const unsaved = useUnsavedChanges(isDirty)
  const onboarding = useOnboardingSave(workspaceId)
  const [formError, setFormError] = useState<string | null>(null)
  const rows = watch('rows')
  const filled = rows.filter(isFilled).length
  const fieldId = useId()
  const creator = pms[0]

  const members = (): Member[] =>
    queryClient.getQueryData<Member[]>(memberListQueryOptions(workspaceId).queryKey) ?? []

  /**
   * 입력 중 매핑을 저장한다. 성공하면 true — 저장한 값이 새 기준이라 더 묻지 않는다.
   * `requirePm` 이면 줄 오류가 없을 때 PM 체크를 확인한다. 없으면 저장하지 않고 첫 체크박스로 포커스를 옮긴다
   */
  const saveMappings = async (values: { rows: FormRow[] }, requirePm = false): Promise<boolean> => {
    setFormError(null)
    clearErrors()
    const issues = findMappingIssues(values.rows, members())
    if (issues.size > 0) {
      let first = true
      for (const [index, issue] of issues) {
        setError(
          PM_ISSUES.has(issue) ? `rows.${index}.pmMemberId` : `rows.${index}.name`,
          { type: 'mapping', message: ISSUE_MESSAGES[issue] },
          { shouldFocus: first },
        )
        first = false
      }
      return false
    }
    if (requirePm && creator && values.rows.every(({ pmMemberId }) => pmMemberId === null)) {
      setFormError(PM_REQUIRED)
      setFocus('rows.0.pmMemberId')
      return false
    }
    try {
      await saveMemberMappings(queryClient, workspaceId, values.rows)
    } catch (error) {
      if (error instanceof MappingSaveError) {
        setError(
          values.rows[error.rowIndex].pmMemberId === null
            ? `rows.${error.rowIndex}.name`
            : `rows.${error.rowIndex}.pmMemberId`,
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
        if (!(await saveMappings(values, true))) return
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
            <>
              {creator ? (
                <p className={PM_HINT}>
                  PM {creator.displayName}님의 디스코드 계정을 찾아 체크해 주세요. 이름이 달라도
                  PM으로 연결돼요.
                </p>
              ) : null}
              <ul className="pt-6">
                {initialRows.map((row, index) => {
                  const pmMemberId = rows[index]?.pmMemberId ?? null
                  const picked = pms.find(({ id }) => id === pmMemberId)
                  const pmError = errors.rows?.[index]?.pmMemberId?.message
                  const pmErrorId = pmError ? `${fieldId}-${index}-pm-error` : undefined
                  return (
                    <li key={row.discordUserId} className={ROW}>
                      {creator ? (
                        <PmCheck
                          control={control}
                          index={index}
                          username={row.username}
                          pm={creator}
                          takenElsewhere={rows.some(
                            (other, otherIndex) =>
                              otherIndex !== index && other.pmMemberId === creator.id,
                          )}
                          errorId={pmErrorId}
                        />
                      ) : null}
                      <span className={HANDLE}>
                        <span className={HANDLE_TEXT}>@{row.username}</span>
                        {pmMemberId === null ? null : <span className={PM_LABEL}>PM</span>}
                      </span>
                      <Icon name="arrow-right" size={12} className="mt-15 shrink-0 text-dashed" />
                      <div className={FIELDS}>
                        {/* PM 을 체크한 줄은 이름을 보지 않는다. 적어 둔 이름은 남겨 두고 PM 이름을 잠가 보인다 */}
                        {pmMemberId === null ? (
                          <TextField
                            key="name"
                            tone="onboarding"
                            aria-label={`@${row.username}의 팀원 이름`}
                            placeholder="누구인가요?"
                            error={errors.rows?.[index]?.name?.message}
                            {...register(`rows.${index}.name`)}
                          />
                        ) : (
                          <TextField
                            key="pm"
                            tone="onboarding"
                            aria-label={`@${row.username}의 팀원 이름`}
                            value={picked?.displayName ?? ''}
                            disabled
                          />
                        )}
                        {pmError ? <ErrorText id={pmErrorId}>{pmError}</ErrorText> : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
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
      pms={members.data
        .filter(({ role }) => role === 'pm')
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))}
      notice={notice}
      previous={previous}
    />
  )
}
