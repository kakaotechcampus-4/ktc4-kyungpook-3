import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { z } from 'zod'
import { WORKSPACE_LIST_QUERY_KEY, workspaceListQueryOptions } from '@/entities/workspace'
import type { Workspace } from '@/entities/workspace'
import { useCreateWorkspace, useOnboardingSave } from '@/features/onboarding'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError } from '@/shared/api/errors'
import { useAppForm } from '@/shared/lib/form'
import { useGuardedNavigate, useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { WORKSPACE_NAME_MAX_LENGTH, checkWorkspaceName } from '@/shared/lib/validation'
import type { WorkspaceNameIssue } from '@/shared/lib/validation'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { TextField } from '@/shared/ui/text-field'
import { ExitLink } from './ExitLink'
import { OnboardingCard } from './OnboardingCard'
import { OnboardingLayout } from './OnboardingLayout'
import { STEP_TITLE } from './stepTitles'

const MESSAGES = [
  '안녕하세요! 회의록 정리부터 마감 리마인드까지, 제가 도와드릴게요.',
  '먼저 팀 이름만 알려주세요. 나중에 언제든 바꿀 수 있어요.',
] as const

const NAME_MESSAGES: Record<WorkspaceNameIssue, string> = {
  empty: '팀 이름을 입력해 주세요.',
  too_long: `팀 이름은 ${WORKSPACE_NAME_MAX_LENGTH}자까지 쓸 수 있어요.`,
  duplicated: '이미 있는 팀 이름이에요.',
}

const CARD = {
  title: '팀 만들기',
  description: '이 이름으로 노션 페이지와 디스코드 알림에 표시돼요.',
} as const

function StepFrame({ children }: { children: ReactNode }) {
  return (
    <OnboardingLayout
      stepNumber={1}
      title={STEP_TITLE.create_workspace}
      exit={<ExitLink />}
      messages={MESSAGES}
    >
      {children}
    </OnboardingLayout>
  )
}

/**
 * 온보딩 1단계 — 새 공간 (D-014). 이름은 M3 의 정규화·1~20자·계정 내 중복(대소문자 구분) 검사를 그대로 쓴다.
 * 생성 뒤 단계 저장이 실패해도 만든 공간을 기억해 두고 재시도는 단계 저장만 한다 — 공간이 두 개 생기지 않는다.
 */
export function CreateWorkspaceStep() {
  // 소속 목록을 구독해 두고, 검사(blur·제출) 때 그 순간의 캐시에서 이름을 읽는다
  useQuery(workspaceListQueryOptions())
  const queryClient = useQueryClient()
  const [schema] = useState(() =>
    z.object({
      name: z.string().superRefine((value, context) => {
        const names = (queryClient.getQueryData<Workspace[]>(WORKSPACE_LIST_QUERY_KEY) ?? []).map(
          ({ name }) => name,
        )
        const check = checkWorkspaceName(value, names)
        if (!check.ok) context.addIssue({ code: 'custom', message: NAME_MESSAGES[check.issue] })
      }),
    }),
  )
  const { form, submit } = useAppForm(schema, { name: '' })
  const {
    register,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = form
  const flow = useCreateWorkspace()
  const navigate = useGuardedNavigate()
  const unsaved = useUnsavedChanges(isDirty && flow.created === null)
  const [formError, setFormError] = useState<string | null>(null)

  const [retrying, setRetrying] = useState(false)

  const run = async (name: string) => {
    setFormError(null)
    try {
      const next = await flow.create(name)
      unsaved.release()
      navigate(next, { replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'WORKSPACE_NAME_DUPLICATED') {
        setError('name', { type: 'server', message: errorMessage(error) }, { shouldFocus: true })
        return
      }
      setFormError(errorMessage(error))
    }
  }

  const onSubmit = submit(({ name }) => run(checkWorkspaceName(name).name))

  /* 공간은 이미 있다 — 이름을 다시 검사하지 않는다(방금 만든 공간이 목록에 있어 중복으로 보인다).
     생성 요청 없이 단계 저장만 다시 한다 */
  const retry = () => {
    if (retrying || flow.created === null) return
    setRetrying(true)
    void run(flow.created.name).finally(() => setRetrying(false))
  }

  return (
    <StepFrame>
      <form
        noValidate
        onSubmit={(event) => {
          // 만든 뒤의 Enter 도 재시도다 — 이름 검사를 다시 타지 않는다
          if (flow.created !== null) {
            event.preventDefault()
            retry()
            return
          }
          void onSubmit(event)
        }}
      >
        <OnboardingCard
          title={CARD.title}
          description={CARD.description}
          actions={
            flow.created === null ? (
              <Button type="submit" variant="primary" size="lg-onboarding" loading={isSubmitting}>
                만들기
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                size="lg-onboarding"
                loading={retrying}
                onClick={retry}
              >
                다시 시도
              </Button>
            )
          }
        >
          <FormErrorPanel message={formError} className="mt-6" />
          <TextField
            tone="onboarding"
            label="팀 이름"
            className="pt-6"
            readOnly={flow.created !== null}
            error={errors.name?.message}
            {...register('name')}
          />
        </OnboardingCard>
      </form>
    </StepFrame>
  )
}

export interface ResumeCreateStepProps {
  workspace: Workspace
}

/**
 * 공간은 만들어졌는데 생성 단계 저장이 안 된 채 돌아왔을 때(새로고침·재로그인).
 * 이름은 바꿀 수 없고 `다음` 은 단계 저장만 한다 — 워크스페이스 생성 요청을 다시 보내지 않는다.
 */
export function ResumeCreateStep({ workspace }: ResumeCreateStepProps) {
  const onboarding = useOnboardingSave(workspace.id)
  return (
    <StepFrame>
      <OnboardingCard
        title={CARD.title}
        description={CARD.description}
        actions={
          <Button
            variant="primary"
            size="lg-onboarding"
            loading={onboarding.isPending}
            onClick={() =>
              void onboarding
                .save({ step: 'create_workspace', action: 'complete' })
                .catch(() => undefined)
            }
          >
            다음
          </Button>
        }
      >
        <FormErrorPanel
          message={onboarding.error ? errorMessage(onboarding.error) : null}
          className="mt-6"
        />
        <TextField
          tone="onboarding"
          label="팀 이름"
          className="pt-6"
          readOnly
          value={workspace.name}
        />
      </OnboardingCard>
    </StepFrame>
  )
}
