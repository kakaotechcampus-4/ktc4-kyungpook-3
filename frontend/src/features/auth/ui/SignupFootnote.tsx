import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { useAuthNext } from '../model/useAuthNext'

const FOOTNOTE = 'text-center text-[14px] text-dim'

const FOOTNOTE_LINK = 'font-semibold text-ink underline underline-offset-3'

/** 이메일·카카오 가입 아래의 로그인 링크. `next` 를 들고 간다 */
export function SignupFootnote() {
  const next = useAuthNext()
  return (
    <p className={FOOTNOTE}>
      이미 계정이 있으신가요?{' '}
      <GuardedLink to={paths.login(next)} className={FOOTNOTE_LINK}>
        로그인
      </GuardedLink>
    </p>
  )
}
