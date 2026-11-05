import { useState } from 'react'
import { useNavigate } from 'react-router'
import { confirmPasswordReset, resetLinkProblem } from '@/entities/user'
import type { ResetLinkProblem } from '@/entities/user'
import { COMMON_MESSAGES, errorMessage } from '@/shared/api/errorMessages'
import { paths } from '@/shared/config/routes'
import { useAppForm } from '@/shared/lib/form'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { PasswordField } from '@/shared/ui/password-field'
import { applyServerError } from '../lib/serverError'
import { RESET_LINK_MESSAGES } from '../model/passwordReset'
import { PASSWORD_HINT, resetPasswordSchema } from '../model/schemas'
import { useFinishPasswordReset } from '../model/useFinishPasswordReset'
import { useResetLink } from '../model/useResetLink'
import { LoginFootnote } from './LoginFootnote'

const FORM = 'flex flex-col gap-16'

const CHECKING = 'text-body text-dim'

/** 이 코드는 새 비밀번호 칸의 오류다. `details.fields` 는 읽지 않는다 — 칸이 하나다 */
const FIELD_BY_CODE = { INVALID_REQUEST: 'newPassword' } as const

/** 메일 링크로 연 비밀번호 변경. 링크 상태마다 화면이 하나다 (useResetLink) */
export function ResetPasswordForm() {
  const { link, reject } = useResetLink()
  const navigate = useNavigate()

  let body
  switch (link.status) {
    case 'checking':
      body = (
        <p role="status" className={CHECKING}>
          링크를 확인하고 있어요.
        </p>
      )
      break
    case 'ready':
      body = <NewPasswordForm token={link.token} onRejected={reject} />
      break
    case 'rejected':
      body = (
        <FormErrorPanel
          message={RESET_LINK_MESSAGES[link.problem]}
          action={
            <Button size="sm" onClick={() => void navigate(paths.forgotPassword())}>
              다시 요청하기
            </Button>
          }
        />
      )
      break
    case 'failed':
      body = (
        <FormErrorPanel
          message={errorMessage(link.error)}
          action={
            <Button size="sm" onClick={link.retry}>
              {COMMON_MESSAGES.retry}
            </Button>
          }
        />
      )
      break
  }

  return (
    <>
      {body}
      <LoginFootnote />
    </>
  )
}

interface NewPasswordFormProps {
  token: string
  onRejected: (problem: ResetLinkProblem) => void
}

function NewPasswordForm({ token, onRejected }: NewPasswordFormProps) {
  const { form, submit } = useAppForm(resetPasswordSchema, { newPassword: '' })
  const {
    register,
    setError,
    formState: { errors, isSubmitting },
  } = form
  const [formError, setFormError] = useState<string | null>(null)
  const finish = useFinishPasswordReset()

  const onSubmit = submit(async ({ newPassword }) => {
    setFormError(null)
    try {
      await confirmPasswordReset({ token, newPassword })
    } catch (error) {
      const problem = resetLinkProblem(error)
      if (problem !== null) onRejected(problem)
      else setFormError(applyServerError(error, setError, FIELD_BY_CODE))
      return
    }
    await finish()
  })

  return (
    <form noValidate className={FORM} onSubmit={(event) => void onSubmit(event)}>
      <FormErrorPanel message={formError} />
      <PasswordField
        tone="auth"
        label="새 비밀번호"
        autoComplete="new-password"
        showLabel="비밀번호 보기"
        hideLabel="비밀번호 숨기기"
        description={PASSWORD_HINT}
        error={errors.newPassword?.message}
        {...register('newPassword')}
      />
      <Button type="submit" variant="primary" size="auth" loading={isSubmitting} className="mt-8">
        비밀번호 바꾸기
      </Button>
    </form>
  )
}
