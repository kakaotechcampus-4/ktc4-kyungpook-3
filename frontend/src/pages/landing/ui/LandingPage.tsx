import { FinalCta, LandingFooter } from './LandingClosing'
import { LandingHeader } from './LandingHeader'
import { LandingHero } from './LandingHero'
import { Capabilities, FeatureCards, ValueSections } from './LandingSections'
import { MascotShowcase } from './MascotShowcase'
import { ProductPreview } from './ProductPreview'

/**
 * Landing 캔버스. 주 CTA 는 모두 `시작하기` → 로그인이다 (D-003). 회원가입 직접 링크·데모 버튼은 없다 (D-002, D-004).
 * 요금제 절과 자주 묻는 것 절은 이번에 뺐다 — docs/impl-decision/2026-09-28-landing-scope.md
 */
export function LandingPage() {
  return (
    <div id="top" className="flex min-h-dvh flex-col items-center bg-surface text-ink">
      <LandingHeader />
      <main className="flex w-full flex-col items-center px-40">
        <LandingHero />
        <ProductPreview />
        <ValueSections />
        <FeatureCards />
        <MascotShowcase />
        <Capabilities />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  )
}
