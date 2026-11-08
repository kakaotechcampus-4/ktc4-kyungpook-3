import { ForgotPasswordForm } from '@/features/auth'
import { AuthShell } from '@/widgets/auth-shell'
import { FORGOT_PASSWORD_SHELL } from './shell'

/** 비밀번호 재설정 메일 요청 (#356). 캔버스가 없어 로그인·회원가입의 틀을 그대로 쓴다 */
export function ForgotPasswordPage() {
  return (
    <AuthShell {...FORGOT_PASSWORD_SHELL}>
      <ForgotPasswordForm />
    </AuthShell>
  )
}
