import { useState } from 'react'
import { requestSignupCode, signupCodeCooldown } from '@/entities/user'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { useAppForm } from '@/shared/lib/form'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { TextField } from '@/shared/ui/text-field'
import { applyServerError } from '../lib/serverError'
import { signupEmailSchema } from '../model/schemas'
import { KAKAO_EMAIL_TAKEN_MESSAGE } from '../model/signupStep'
import { AlternativeAuth } from './AlternativeAuth'

const FORM = 'flex flex-col gap-16'

/** 이 코드들은 이메일 칸의 오류다 */
const FIELD_BY_CODE = {
  EMAIL_ALREADY_EXISTS: 'email',
  INVALID_REQUEST: 'email',
} as const

interface SignupEmailStepProps {
  linkKakao: boolean
  /** 앞 단계에서 되돌아온 까닭. 폼 상단에 보인다 */
  notice: string | null
  /** 코드를 보냈다. `resendAfter` 초 뒤에 다시 보낼 수 있다 */
  onSent: (email: string, resendAfter: number) => void
}

/** 가입 첫 단계. 60초 제한(429 cooldown)은 방금 코드를 보냈다는 뜻이라 실패가 아니라 코드 단계로 넘어간다 */
export function SignupEmailStep({ linkKakao, notice, onSent }: SignupEmailStepProps) {
  const { form, submit } = useAppForm(signupEmailSchema, { email: '' })
  const {
    register,
    setError,
    formState: { errors, isSubmitting },
  } = form
  const [formError, setFormError] = useState(notice)

  const onSubmit = submit(async ({ email }) => {
    setFormError(null)
    try {
      const { resendAfter } = await requestSignupCode(email)
      onSent(email, resendAfter)
    } catch (error) {
      const cooldown = signupCodeCooldown(error)
      if (cooldown !== null) onSent(email, cooldown)
      else if (
        linkKakao &&
        error instanceof ApiError &&
        error.code === ERROR_CODES.EMAIL_ALREADY_EXISTS
      )
        setError(
          'email',
          { type: 'server', message: KAKAO_EMAIL_TAKEN_MESSAGE },
          { shouldFocus: true },
        )
      else setFormError(applyServerError(error, setError, FIELD_BY_CODE))
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
        <Button type="submit" variant="primary" size="auth" loading={isSubmitting} className="mt-8">
          인증 코드 받기
        </Button>
      </form>
      {linkKakao ? null : <AlternativeAuth />}
    </>
  )
}
