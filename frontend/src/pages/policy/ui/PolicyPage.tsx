import { Link } from 'react-router'
import { policyDocuments } from '@/shared/config/policy'
import { currentPolicyPublication } from '@/shared/config/policyPublication'
import type { PolicyKind } from '@/shared/config/policy'
import { paths } from '@/shared/config/routes'
import { BrandMark } from '@/shared/ui/brand-mark'

function PolicyPage({ kind }: { kind: PolicyKind }) {
  const document = policyDocuments[kind]
  const published =
    currentPolicyPublication.kind === 'published' ? currentPolicyPublication.documents[kind] : null

  return (
    <div className="flex min-h-dvh flex-col bg-surface text-ink">
      <header className="border-b border-line px-24 sm:px-40">
        <div className="mx-auto flex min-h-72 max-w-[860px] items-center justify-between gap-20">
          <Link
            to={paths.landing()}
            className="inline-flex items-center gap-9 text-body font-semibold"
          >
            <BrandMark />
            <span>Manager&apos;s Manager</span>
          </Link>
          <Link to={paths.login()} className="shrink-0 text-body text-dim hover:text-ink">
            로그인
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[860px] flex-1 flex-col gap-32 px-24 py-48 sm:px-40">
        <nav aria-label="정책 문서" className="flex flex-wrap gap-10">
          {Object.values(policyDocuments).map(({ title, to }) => (
            <Link
              key={to}
              to={to}
              aria-current={to === document.to ? 'page' : undefined}
              className={
                to === document.to
                  ? 'rounded-9 bg-ink-solid px-14 py-10 text-body font-semibold text-surface'
                  : 'rounded-9 bg-control px-14 py-10 text-body text-sub hover:bg-line'
              }
            >
              {title}
            </Link>
          ))}
        </nav>
        <section aria-labelledby="policy-title" className="flex flex-col gap-24">
          <h1 id="policy-title" className="text-[30px] leading-[1.25] font-bold tracking-h1">
            {document.title}
          </h1>
          {published === null ? (
            <div className="flex flex-col gap-10 rounded-16 border border-line bg-surface-sunken p-24">
              <p className="text-lead font-semibold">문서를 준비하고 있어요.</p>
              <p className="text-body text-sub">내용과 시행일은 검토가 끝난 뒤 공개할게요.</p>
            </div>
          ) : (
            <>
              <p className="text-body text-sub">
                판본 {published.version} · 시행일 {published.effectiveOn}
              </p>
              {published.sections.map((section) => (
                <section key={section.title} className="flex flex-col gap-12">
                  <h2 className="text-lead font-semibold">{section.title}</h2>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph} className="text-body leading-relaxed break-words text-sub">
                      {paragraph}
                    </p>
                  ))}
                </section>
              ))}
              {published.references.length > 0 ? (
                <section aria-label="공식 참고 자료" className="flex flex-col gap-12">
                  <h2 className="text-lead font-semibold">공식 참고 자료와 문의</h2>
                  <ul className="flex flex-col gap-10">
                    {published.references.map(({ label, href }) => (
                      <li key={href}>
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-body break-words text-sub underline underline-offset-3 hover:text-ink"
                        >
                          {label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          )}
        </section>
      </main>
    </div>
  )
}

export function TermsPage() {
  return <PolicyPage kind="terms" />
}

export function PrivacyPage() {
  return <PolicyPage kind="privacy" />
}
