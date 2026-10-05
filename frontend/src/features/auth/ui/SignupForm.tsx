import { useState } from 'react'
import { signup } from '@/entities/user'
import { paths } from '@/shared/config/routes'
import { useAppForm } from '@/shared/lib/form'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { PasswordField } from '@/shared/ui/password-field'
import { TextField } from '@/shared/ui/text-field'
import { applyServerError } from '../lib/serverError'
import { PASSWORD_HINT, signupSchema } from '../model/schemas'
import type { SignupValues } from '../model/schemas'
import { useEnterSession } from '../model/useEnterSession'
import { AlternativeAuth } from './AlternativeAuth'

const FORM = 'flex flex-col gap-16'

const FOOTNOTE = 'text-center text-[14px] text-dim'

const FOOTNOTE_LINK = 'font-semibold text-ink underline underline-offset-3'

/** 이 코드는 이메일 칸의 오류다. 입력 아래에 띄우고 그 칸으로 포커스를 옮긴다 */
const FIELD_BY_CODE = { EMAIL_ALREADY_EXISTS: 'email' } as const satisfies Partial<
  Record<string, keyof SignupValues>
>

/**
 * 이름·이메일·비밀번호 가입. 가입하면 바로 로그인되고 로그인과 같은 경로로 이동한다.
 * Signup 캔버스의 비밀번호 강도 표시와 약관 동의는 이번 범위에서 뺐다 — 규칙 안내 한 줄만 남긴다.
 */
export function SignupForm() {
  const { form, submit } = useAppForm(signupSchema, { name: '', email: '', password: '' })
  const {
    register,
    setError,
    formState: { errors, isSubmitting },
  } = form
  const enterSession = useEnterSession()
  const [formError, setFormError] = useState<string | null>(null)

  const onSubmit = submit(async (values) => {
    setFormError(null)
    try {
      await enterSession(await signup(values))
    } catch (error) {
      setFormError(applyServerError(error, setError, FIELD_BY_CODE))
    }
  })

  return (
    <>
      <form noValidate className={FORM} onSubmit={(event) => void onSubmit(event)}>
        <FormErrorPanel message={formError} />
        <TextField
          tone="auth"
          label="이름"
          autoComplete="name"
          error={errors.name?.message}
          {...register('name')}
        />
        <TextField
          tone="auth"
          type="email"
          label="이메일"
          autoComplete="email"
          error={errors.email?.message}
          {...register('email')}
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
        <Button type="submit" variant="primary" size="auth" loading={isSubmitting} className="mt-8">
          계정 만들기
        </Button>
      </form>
      <AlternativeAuth googleLabel="Google 계정으로 가입하기" />
      <p className={FOOTNOTE}>
        이미 계정이 있으신가요?{' '}
        <GuardedLink to={paths.login()} className={FOOTNOTE_LINK}>
          로그인
        </GuardedLink>
      </p>
    </>
  )
}
