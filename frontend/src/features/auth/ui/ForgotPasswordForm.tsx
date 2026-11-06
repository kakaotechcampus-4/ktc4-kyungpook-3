import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { requestPasswordReset } from '@/entities/user'
import { errorMessage } from '@/shared/api/errorMessages'
import { useAppForm } from '@/shared/lib/form'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { Panel } from '@/shared/ui/panel'
import { TextField } from '@/shared/ui/text-field'
import { applyServerError } from '../lib/serverError'
import { RESEND_COOLDOWN_MS } from '../model/passwordReset'
import { forgotPasswordSchema } from '../model/schemas'
import { LoginFootnote } from './LoginFootnote'
import { ResendButton } from './ResendButton'

const FORM = 'flex flex-col gap-16'

const LEAD = 'text-[14px] leading-[22px] text-dim'

const BODY = 'text-body text-ink'

/** 메일을 보낸 뒤. 보낸 시각은 응답을 받은 때다 — 서버의 60초가 먼저 끝난다 */
interface SentMail {
  email: string
  sentAt: number
}

function sentNow(email: string): SentMail {
  return { email, sentAt: Date.now() }
}

/** 이 코드는 이메일 칸의 오류다 */
const FIELD_BY_CODE = { INVALID_REQUEST: 'email' } as const

/**
 * 비밀번호 재설정 메일 요청. 가입하지 않은 이메일도 서버가 같은 200 을 주므로 보냈다고 단정하지 않는다.
 * 보낸 뒤에는 같은 이메일로만 다시 보낸다.
 */
export function ForgotPasswordForm() {
  const { form, submit } = useAppForm(forgotPasswordSchema, { email: '' })
  const {
    register,
    setError,
    formState: { errors, isSubmitting },
  } = form
  const [formError, setFormError] = useState<string | null>(null)
  const [sent, setSent] = useState<SentMail | null>(null)
  const resend = useMutation({
    mutationFn: requestPasswordReset,
    onSuccess: (_, email) => setSent(sentNow(email)),
  })

  const onSubmit = submit(async ({ email }) => {
    setFormError(null)
    try {
      await requestPasswordReset(email)
      setSent(sentNow(email))
    } catch (error) {
      setFormError(applyServerError(error, setError, FIELD_BY_CODE))
    }
  })

  if (sent !== null) {
    return (
      <>
        <FormErrorPanel message={resend.isError ? errorMessage(resend.error) : null} />
        <Panel role="status">
          <p className={BODY}>{sent.email} 주소로 가입한 계정이 있으면 재설정 링크를 보냈어요.</p>
          <p className={LEAD}>
            링크는 30분 동안 쓸 수 있어요. 메일이 오지 않으면 스팸함을 확인해 주세요.
          </p>
        </Panel>
        <ResendButton
          key={sent.sentAt}
          resendAt={sent.sentAt + RESEND_COOLDOWN_MS}
          pending={resend.isPending}
          onResend={() => resend.mutate(sent.email)}
        />
        <LoginFootnote />
      </>
    )
  }

  return (
    <>
      <form noValidate className={FORM} onSubmit={(event) => void onSubmit(event)}>
        <p className={LEAD}>가입한 이메일을 입력하면 비밀번호를 바꿀 수 있는 링크를 보내 드려요.</p>
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
          재설정 링크 보내기
        </Button>
      </form>
      <LoginFootnote />
    </>
  )
}
