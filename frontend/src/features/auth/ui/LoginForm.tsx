import { useState } from 'react'
import { login } from '@/entities/user'
import { paths } from '@/shared/config/routes'
import { useAppForm } from '@/shared/lib/form'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { PasswordField } from '@/shared/ui/password-field'
import { TextField } from '@/shared/ui/text-field'
import { applyServerError } from '../lib/serverError'
import { loginSchema } from '../model/schemas'
import { useEnterSession } from '../model/useEnterSession'
import { AlternativeAuth } from './AlternativeAuth'

const FORM = 'flex flex-col gap-16'

/* 비밀번호 재설정은 1차 범위 밖이라 비활성이다. 누를 수도, 포커스를 받을 수도 없다.
   준비 중 문구·배지를 달지 않는다 (D-005, D-006) */
const FORGOT = 'text-[13px] text-faint'

const FOOTNOTE = 'text-center text-[14px] text-dim'

const FOOTNOTE_LINK = 'font-semibold text-ink underline underline-offset-3'

/**
 * 이메일·비밀번호 로그인. 이메일 형식과 비밀번호 빈 값만 검사한다.
 * 잘못된 자격 증명은 어느 칸의 잘못인지 알 수 없어 폼 상단의 비필드 오류다.
 * 회원가입은 여기의 링크로만 간다 — 랜딩에서 바로 가지 않는다 (D-004).
 */
export function LoginForm() {
  const { form, submit } = useAppForm(loginSchema, { email: '', password: '' })
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
      await enterSession(await login(values))
    } catch (error) {
      setFormError(applyServerError(error, setError, {}))
    }
  })

  return (
    <>
      <form noValidate className={FORM} onSubmit={(event) => void onSubmit(event)}>
        <FormErrorPanel message={formError} />
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
          autoComplete="current-password"
          showLabel="비밀번호 보기"
          hideLabel="비밀번호 숨기기"
          labelEnd={
            <button type="button" disabled className={FORGOT}>
              비밀번호를 잊으셨나요?
            </button>
          }
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" variant="primary" size="auth" loading={isSubmitting} className="mt-8">
          로그인
        </Button>
      </form>
      <AlternativeAuth googleLabel="Google 계정으로 로그인" />
      <p className={FOOTNOTE}>
        처음이신가요?{' '}
        <GuardedLink to={paths.signup()} className={FOOTNOTE_LINK}>
          회원가입
        </GuardedLink>
      </p>
    </>
  )
}
