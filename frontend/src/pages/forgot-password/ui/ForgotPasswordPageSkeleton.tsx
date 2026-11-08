import { ForgotPasswordFormSkeleton } from '@/features/auth/skeleton'
import { AuthShellSkeleton } from '@/widgets/auth-shell/skeleton'
import { FORGOT_PASSWORD_SHELL } from './shell'

/** 비밀번호 찾기 화면 코드·세션 확인을 기다리는 라우트 뼈대 (#510). 화면과 같은 틀·문구다 */
export function ForgotPasswordPageSkeleton() {
  return (
    <AuthShellSkeleton title={FORGOT_PASSWORD_SHELL.title} aside={FORGOT_PASSWORD_SHELL.aside}>
      <ForgotPasswordFormSkeleton />
    </AuthShellSkeleton>
  )
}
