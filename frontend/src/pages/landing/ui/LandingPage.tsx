import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { PagePlaceholder } from '@/shared/ui/page-placeholder'

const LINK = 'text-body font-semibold text-ink underline'

export function LandingPage() {
  return (
    <PagePlaceholder title="랜딩" description="랜딩 화면은 M4에서 만들어요.">
      <GuardedLink to={paths.login()} className={LINK}>
        로그인으로
      </GuardedLink>
    </PagePlaceholder>
  )
}
