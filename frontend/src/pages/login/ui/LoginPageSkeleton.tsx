import { LoginFormSkeleton } from '@/features/auth/skeleton'
import { AuthShellSkeleton } from '@/widgets/auth-shell/skeleton'
import { LOGIN_SHELL } from './shell'

/** 로그인 화면 코드·세션 확인을 기다리는 라우트 뼈대 (#510). 화면과 같은 틀·문구다 */
export function LoginPageSkeleton() {
  return (
    <AuthShellSkeleton title={LOGIN_SHELL.title} aside={LOGIN_SHELL.aside}>
      <LoginFormSkeleton />
    </AuthShellSkeleton>
  )
}
