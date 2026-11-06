import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import {
  confirmSignupCode,
  requestSignupCode,
  signupCodeCooldown,
  signupCodeProblem,
} from '@/entities/user'
import { errorMessage } from '@/shared/api/errorMessages'
import { useAppForm } from '@/shared/lib/form'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { Panel } from '@/shared/ui/panel'
import { TextField } from '@/shared/ui/text-field'
import { signupCodeSchema } from '../model/schemas'
import { signupCodeMessage } from '../model/signupStep'
import { ResendButton } from './ResendButton'

const FORM = 'flex flex-col gap-16'

const BODY = 'text-body text-ink'

const LEAD = 'text-[14px] leading-[22px] text-dim'

const ACTIONS = 'flex flex-col gap-8'

interface SignupCodeStepProps {
  email: string
  resendAt: number
  onResent: (resendAfter: number) => void
  onConfirmed: (verificationToken: string) => void
  onChangeEmail: () => void
}

/** 메일로 받은 코드 확인. 만료·횟수 초과에도 이 단계에 남고 다시 보내기로 이어 간다 */
export function SignupCodeStep({
  email,
  resendAt,
  onResent,
  onConfirmed,
  onChangeEmail,
}: SignupCodeStepProps) {
  const { form, submit } = useAppForm(signupCodeSchema, { code: '' })
  const {
    register,
    reset,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = form
  const [formError, setFormError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  useEffect(() => {
    setFocus('code')
  }, [setFocus])

  const resend = useMutation({
    mutationFn: () => requestSignupCode(email),
    onSuccess: ({ resendAfter }) => {
      reset()
      setFormError(null)
      setResent(true)
      onResent(resendAfter)
      setFocus('code')
    },
    onError: (error) => {
      const cooldown = signupCodeCooldown(error)
      if (cooldown === null) setFormError(errorMessage(error))
      else onResent(cooldown)
    },
  })

  const onSubmit = submit(async ({ code }) => {
    setFormError(null)
    try {
      onConfirmed(await confirmSignupCode({ email, code }))
    } catch (error) {
      const problem = signupCodeProblem(error)
      if (problem === null) setFormError(errorMessage(error))
      else
        setError(
          'code',
          { type: 'server', message: signupCodeMessage(problem) },
          { shouldFocus: true },
        )
    }
  })

  return (
    <>
      <FormErrorPanel message={formError} />
      <Panel role="status">
        <p className={BODY}>
          {email} 주소로 {resent ? '새 코드를' : '6자리 코드를'} 보냈어요.
        </p>
        <p className={LEAD}>
          코드는 10분 동안 쓸 수 있어요. 메일이 오지 않으면 스팸함을 확인해 주세요.
        </p>
      </Panel>
      <form noValidate className={FORM} onSubmit={(event) => void onSubmit(event)}>
        <TextField
          tone="auth"
          label="인증 코드"
          inputMode="numeric"
          autoComplete="one-time-code"
          error={errors.code?.message}
          {...register('code')}
        />
        <Button type="submit" variant="primary" size="auth" loading={isSubmitting} className="mt-8">
          코드 확인
        </Button>
      </form>
      <div className={ACTIONS}>
        <ResendButton
          key={resendAt}
          variant="outline"
          resendAt={resendAt}
          pending={resend.isPending}
          onResend={() => resend.mutate()}
        />
        <Button variant="text" size="auth" onClick={onChangeEmail}>
          이메일 바꾸기
        </Button>
      </div>
    </>
  )
}
