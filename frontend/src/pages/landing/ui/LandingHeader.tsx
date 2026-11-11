import { BrandMark } from '@/shared/ui/brand-mark'
import { CARD_WIDTH, LINK_PRIMARY, NAV_SIZE } from './styles'
import { StartLink } from './StartLink'

const NAV_ITEMS = [
  { label: '제품', href: '#product' },
  { label: '기능', href: '#features' },
  { label: '연동', href: '#integrations' },
] as const

export function LandingHeader() {
  return (
    <header className="w-full border-b border-line px-20 sm:px-40">
      <div
        className={`${CARD_WIDTH} flex min-h-[84px] flex-wrap items-center justify-between gap-x-16 gap-y-18 py-18 sm:flex-nowrap sm:py-0`}
      >
        <a
          href="#top"
          className="inline-flex items-center gap-9 text-[15px] font-semibold tracking-h3 text-ink max-[360px]:gap-7 max-[360px]:text-[13px] sm:text-landing"
        >
          <BrandMark />
          <span>Manager&apos;s Manager</span>
          <span aria-hidden="true" className="h-6 w-6 rounded-999 bg-accent-solid" />
        </a>
        <nav
          aria-label="랜딩 안내"
          className="order-3 flex w-full justify-center gap-32 text-[14px] font-semibold sm:order-none sm:w-auto"
        >
          {NAV_ITEMS.map(({ label, href }) => (
            <a key={label} href={href} className="hover:text-accent">
              {label}
            </a>
          ))}
        </nav>
        <StartLink className={`${LINK_PRIMARY} ${NAV_SIZE} max-[360px]:px-12`}>시작하기</StartLink>
      </div>
    </header>
  )
}
