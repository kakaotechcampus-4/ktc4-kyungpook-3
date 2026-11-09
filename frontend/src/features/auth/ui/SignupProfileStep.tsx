import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { ConsentFields, emptyConsentSelection, policyVersions } from '@/entities/consent'
import { UsernameField, signup, usernameRejection, useUsernameCheck } from '@/entities/user'
import type { SignupInput } from '@/entities/user'
import { errorMessage } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { currentPolicyPublication } from '@/shared/config/policyPublication'
import { paths } from '@/shared/config/routes'
import { useAppForm } from '@/shared/lib/form'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { PasswordField } from '@/shared/ui/password-field'
import { TextField } from '@/shared/ui/text-field'
import { useAuthNext } from '../model/useAuthNext'
import { useEnterSession } from '../model/useEnterSession'
import { isKakaoLinkExpired } from '../model/useKakaoLink'
import { PASSWORD_HINT, kakaoProfileSchema, signupProfileSchema } from '../model/schemas'
import type { SignupProfile } from '../model/signupStep'

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

/**
 * 가입 마지막 단계. 아이디는 중복 확인이 지금 입력과 맞아야 `계정 만들기` 가 켜진다 (#627).
 * 이메일 가입은 인증한 이메일을 보여 주기만 하고 비밀번호를 받는다. 서버는 본문의 이메일을 받지 않고 증명의 값으로 만든다.
 * 카카오 가입은 이메일·비밀번호가 없고 이름을 닉네임으로 채운다. 가입하면 바로 로그인되고 로그인과 같은 경로로 이동한다.
 */
export function SignupProfileStep({ profile }: { profile: SignupProfile }) {
  const { form, submit } = useAppForm(
    profile.kind === 'email' ? signupProfileSchema : kakaoProfileSchema,
    { username: '', name: profile.kind === 'kakao' ? (profile.nickname ?? '') : '', password: '' },
  )
  const {
    register,
    setFocus,
    watch,
    formState: { errors, isSubmitting },
  } = form
  const usernameCheck = useUsernameCheck(watch('username'))
  const enterSession = useEnterSession()
  const navigate = useNavigate()
  const next = useAuthNext()
  const [failure, setFailure] = useState<{ message: string; conflict: boolean } | null>(null)
  const [consents, setConsents] = useState(emptyConsentSelection)
  const publication = currentPolicyPublication
  const mustAgree = publication.kind === 'published'
  const agreed = consents.terms && consents.privacy

  useEffect(() => {
    setFocus('username')
  }, [setFocus])

  const onSubmit = submit(async ({ name, password }) => {
    if ((mustAgree && !agreed) || usernameCheck.check.status !== 'available') return
    const { username } = usernameCheck.check
    const input: SignupInput =
      profile.kind === 'email'
        ? { kind: 'email', verificationToken: profile.verificationToken, password, name, username }
        : { kind: 'kakao', name, username }
    setFailure(null)
    try {
      const session = await signup(input)
      await enterSession({
        session,
        acceptance: publication.kind === 'published' ? policyVersions(publication.documents) : null,
      })
    } catch (error) {
      const rejected = usernameRejection(error)
      if (rejected !== null) {
        usernameCheck.reject(username, rejected)
        setFocus('username')
      } else if (profile.kind === 'kakao' && isKakaoLinkExpired(error)) profile.onLinkExpired(error)
      else if (
        profile.kind === 'email' &&
        error instanceof ApiError &&
        error.code === ERROR_CODES.SIGNUP_VERIFICATION_INVALID
      )
        profile.onVerificationLost(errorMessage(error))
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
      {profile.kind === 'email' ? (
        <TextField
          tone="auth"
          type="email"
          label="이메일"
          autoComplete="email"
          readOnly
          value={profile.email}
          className={READ_ONLY_FIELD}
          labelEnd={
            <button type="button" className={CHANGE_EMAIL} onClick={profile.onChangeEmail}>
              이메일 바꾸기
            </button>
          }
        />
      ) : null}
      <UsernameField tone="auth" control={usernameCheck} {...register('username')} />
      <TextField
        tone="auth"
        label="이름"
        autoComplete="name"
        error={errors.name?.message}
        {...register('name')}
      />
      {profile.kind === 'email' ? (
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
      ) : null}
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
        disabled={(mustAgree && !agreed) || !usernameCheck.confirmed}
        className="mt-8"
      >
        계정 만들기
      </Button>
    </form>
  )
}
