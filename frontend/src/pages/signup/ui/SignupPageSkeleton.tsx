import { SignupFormSkeleton } from '@/features/auth/skeleton'
import { AuthShellSkeleton } from '@/widgets/auth-shell/skeleton'
import { SIGNUP_SHELL } from './shell'

/** 회원가입 화면 코드·세션 확인을 기다리는 라우트 뼈대 (#510). 화면과 같은 틀·문구다 */
export function SignupPageSkeleton() {
  return (
    <AuthShellSkeleton title={SIGNUP_SHELL.title} aside={SIGNUP_SHELL.aside}>
      <SignupFormSkeleton />
    </AuthShellSkeleton>
  )
}
