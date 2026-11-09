import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { signup } from '@/entities/user'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { useAppForm } from '@/shared/lib/form'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { PasswordField } from '@/shared/ui/password-field'
import { TextField } from '@/shared/ui/text-field'
import { useAuthNext } from '../model/useAuthNext'
import { useEnterSession } from '../model/useEnterSession'
import { isKakaoLinkExpired } from '../model/useKakaoLink'
import { PASSWORD_HINT, signupProfileSchema } from '../model/schemas'
import { ConsentFields, emptyConsentSelection, policyVersions } from '@/entities/consent'
import { currentPolicyPublication } from '@/shared/config/policyPublication'
import type { SignupStep } from '../model/signupStep'

const FORM = 'flex flex-col gap-16'

const CHANGE_EMAIL = 'text-[13px] text-dim underline underline-offset-3'

/* TextField 의 비활성 면과 같은 모양이다. 읽기 전용은 입력처럼 보이면 안 되고, 자동완성이 읽도록 disabled 로 두지 않는다 */
const READ_ONLY_FIELD = '[&_input]:border-line [&_input]:bg-surface-sunken'

const CONFLICT_CODES: readonly string[] = [
  ERROR_CODES.EMAIL_ALREADY_EXISTS,
  ERROR_CODES.KAKAO_ALREADY_LINKED,
]

function isAccountConflict(error: unknown): boolean {
  return error instanceof ApiError && CONFLICT_CODES.includes(error.code)
}

interface SignupProfileStepProps {
  step: Extract<SignupStep, { step: 'profile' }>
  linkKakao: boolean
  /** 카카오 닉네임. 없으면 빈 칸이다 */
  defaultName: string
  onChangeEmail: () => void
  /** 증명이 만료됐다. 이메일 인증부터 다시 한다 */
  onVerificationLost: (message: string) => void
  onLinkExpired: (error: unknown) => void
}

/**
 * 가입 마지막 단계. 이메일은 보여 주기만 한다 — 서버는 본문의 이메일을 받지 않고 증명이나 카카오 쿠키의 값으로 만든다.
 * 가입하면 바로 로그인되고 로그인과 같은 경로로 이동한다.
 */
export function SignupProfileStep({
  step,
  linkKakao,
  defaultName,
  onChangeEmail,
  onVerificationLost,
  onLinkExpired,
}: SignupProfileStepProps) {
  const { form, submit } = useAppForm(signupProfileSchema, { name: defaultName, password: '' })
  const {
    register,
    setFocus,
    formState: { errors, isSubmitting },
  } = form
  const enterSession = useEnterSession()
  const navigate = useNavigate()
  const next = useAuthNext()
  const [failure, setFailure] = useState<{ message: string; conflict: boolean } | null>(null)
  const [consents, setConsents] = useState(emptyConsentSelection)
  const publication = currentPolicyPublication
  const mustAgree = publication.kind === 'published'
  const agreed = consents.terms && consents.privacy

  useEffect(() => {
    setFocus(defaultName === '' ? 'name' : 'password')
  }, [defaultName, setFocus])

  const onSubmit = submit(async ({ name, password }) => {
    if (mustAgree && !agreed) return
    setFailure(null)
    try {
      const session = await signup({
        verificationToken: step.verificationToken,
        name,
        password,
        linkKakao,
      })
      await enterSession({
        session,
        acceptance: publication.kind === 'published' ? policyVersions(publication.documents) : null,
      })
    } catch (error) {
      if (isKakaoLinkExpired(error)) onLinkExpired(error)
      else if (error instanceof ApiError && error.code === ERROR_CODES.SIGNUP_VERIFICATION_INVALID)
        onVerificationLost(errorMessage(error))
      else setFailure({ message: errorMessage(error), conflict: isAccountConflict(error) })
    }
  })

  return (
    <form noValidate className={FORM} onSubmit={(event) => void onSubmit(event)}>
      <FormErrorPanel
        message={failure?.message}
        action={
          failure?.conflict ? (
            <Button type="button" size="sm" onClick={() => void navigate(paths.login(next))}>
              로그인
            </Button>
          ) : undefined
        }
      />
      <TextField
        tone="auth"
        type="email"
        label="이메일"
        autoComplete="email"
        readOnly
        value={step.email}
        className={READ_ONLY_FIELD}
        labelEnd={
          step.emailLocked ? undefined : (
            <button type="button" className={CHANGE_EMAIL} onClick={onChangeEmail}>
              이메일 바꾸기
            </button>
          )
        }
      />
      <TextField
        tone="auth"
        label="이름"
        autoComplete="name"
        error={errors.name?.message}
        {...register('name')}
      />
      <PasswordField
        tone="auth"
        label="비밀번호"
        autoComplete="new-password"
        showLabel="비밀번호 보기"
        hideLabel="비밀번호 숨기기"
        description={PASSWORD_HINT}
        error={errors.password?.message}
        {...register('password')}
      />
      {publication.kind === 'published' && (
        <ConsentFields
          documents={publication.documents}
          value={consents}
          onChange={setConsents}
          disabled={isSubmitting}
        />
      )}
      <Button
        type="submit"
        variant="primary"
        size="auth"
        loading={isSubmitting}
        disabled={mustAgree && !agreed}
        className="mt-8"
      >
        계정 만들기
      </Button>
    </form>
  )
}
