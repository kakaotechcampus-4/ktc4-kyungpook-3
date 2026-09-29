import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { BrandMark } from '@/shared/ui/brand-mark'
import { Button } from '@/shared/ui/button'
import { CARD_WIDTH, LINK_PRIMARY, NAV_SIZE } from './styles'

/* 요금제 절을 뺐고(가격 미정) 가이드는 1차 범위 밖이라(D-001 시작 가이드) 그 두 칸은 두지 않는다.
   남은 셋은 같은 페이지의 절로 옮긴다 — docs/impl-decision/2026-09-28-landing-scope.md */
const NAV_ITEMS = [
  { label: '제품', href: '#product' },
  { label: '기능', href: '#features' },
  { label: '연동', href: '#values' },
] as const

const HEADER = 'flex h-64 w-full shrink-0 items-center justify-center border-b border-line px-40'

const INNER = `${CARD_WIDTH} flex items-center justify-between gap-32`

const BRAND = 'inline-flex items-center gap-9'

const BRAND_NAME = 'text-landing font-semibold tracking-h3 text-ink'

const NAV = 'flex items-center gap-28'

const NAV_LINK = 'text-landing leading-[24px] font-semibold text-ink hover:text-sub'

/**
 * 랜딩 헤더. 주 CTA 는 `시작하기` 하나이고 로그인으로 간다 (D-003). 회원가입으로 바로 가는 링크는 없다 (D-004).
 * `문의하기` 는 연결할 창구가 아직 없어 비활성이다.
 */
export function LandingHeader() {
  return (
    <header className={HEADER}>
      <div className={INNER}>
        <a href="#top" className={BRAND}>
          <BrandMark />
          <span className={BRAND_NAME}>Manager&apos;s Manager</span>
        </a>
        <nav aria-label="랜딩 안내" className={NAV}>
          {NAV_ITEMS.map(({ label, href }) => (
            <a key={label} href={href} className={NAV_LINK}>
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-10">
          <Button variant="outline" size="landing-nav" aria-disabled="true">
            문의하기
          </Button>
          <GuardedLink to={paths.login()} className={`${LINK_PRIMARY} ${NAV_SIZE}`}>
            시작하기
          </GuardedLink>
        </div>
      </div>
    </header>
  )
}
