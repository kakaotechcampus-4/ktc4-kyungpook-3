import { SignupForm } from '@/features/auth'
import { AuthShell } from '@/widgets/auth-shell'
import { SIGNUP_SHELL } from './shell'

/** Signup 캔버스. 랜딩에서 바로 오지 않고 로그인의 링크로만 온다 (D-004) */
export function SignupPage() {
  return (
    <AuthShell {...SIGNUP_SHELL}>
      <SignupForm />
    </AuthShell>
  )
}
