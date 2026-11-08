import { LoginForm } from '@/features/auth'
import { AuthShell } from '@/widgets/auth-shell'
import { LOGIN_SHELL } from './shell'

/** Login 캔버스. 가드(RedirectIfAuthed)가 로그인한 사용자를 먼저 돌려보낸다 */
export function LoginPage() {
  return (
    <AuthShell {...LOGIN_SHELL}>
      <LoginForm />
    </AuthShell>
  )
}
