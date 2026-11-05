import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'

const FOOTNOTE = 'text-center text-[14px] text-dim'

const FOOTNOTE_LINK = 'font-semibold text-ink underline underline-offset-3'

/** 비밀번호 재설정 화면의 아래 링크. 로그인 화면의 회원가입 링크와 같은 모양이다 */
export function LoginFootnote() {
  return (
    <p className={FOOTNOTE}>
      비밀번호가 생각나셨나요?{' '}
      <GuardedLink to={paths.login()} className={FOOTNOTE_LINK}>
        로그인
      </GuardedLink>
    </p>
  )
}
