import { Link } from 'react-router'
import { policyDocuments } from '@/shared/config/policy'
import { BrandMark } from '@/shared/ui/brand-mark'
import { CARD_WIDTH, HERO_SIZE } from './styles'
import { StartLink } from './StartLink'

export function FinalCta() {
  return (
    <section
      className={`${CARD_WIDTH} mb-64 flex flex-col items-start justify-between gap-28 rounded-[24px] bg-accent-solid px-28 py-40 sm:mb-96 sm:flex-row sm:items-center sm:px-48 sm:py-56`}
    >
      <div className="max-w-[720px]">
        <h2 className="text-[30px] leading-[1.3] font-semibold tracking-h3 text-ink sm:text-[36px]">
          다음 회의부터,
          <br />
          일의 흐름을 함께 정리해 보세요.
        </h2>
        <p className="mt-16 text-[16px] leading-[28px] text-ink">
          회의의 기록과 팀의 다음 행동을 한곳에 모으세요.
        </p>
      </div>
      <StartLink
        className={`inline-flex shrink-0 items-center justify-center rounded-999 bg-ink-solid font-semibold text-surface hover:bg-ink hover:text-surface focus-visible:outline-offset-4 ${HERO_SIZE}`}
      >
        시작하기
      </StartLink>
    </section>
  )
}

export function LandingFooter() {
  return (
    <footer className="w-full border-t border-line px-20 sm:px-40">
      <div
        className={`${CARD_WIDTH} flex flex-col gap-28 py-32 sm:flex-row sm:items-center sm:justify-between sm:py-40`}
      >
        <div className="flex flex-col gap-12">
          <span className="inline-flex items-center gap-9 text-[14px] font-semibold tracking-h3 text-ink">
            <BrandMark size="sm" />
            Manager&apos;s Manager
            <span aria-hidden="true" className="h-6 w-6 rounded-999 bg-accent-solid" />
          </span>
          <p className="text-[12px] leading-[20px] text-dim">
            © 2026 Manager&apos;s Manager · 카카오테크캠퍼스 4기 · 경북대 3팀
          </p>
        </div>
        <nav aria-label="서비스 정책" className="flex flex-wrap gap-20 text-[13px] text-dim">
          {[policyDocuments.terms, policyDocuments.privacy].map(({ title, to }) => (
            <Link key={to} to={to} className="hover:text-ink hover:underline underline-offset-3">
              {title}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
