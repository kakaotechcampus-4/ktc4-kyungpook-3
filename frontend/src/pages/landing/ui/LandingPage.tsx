import { FinalCta, LandingFooter } from './LandingClosing'
import { LandingHeader } from './LandingHeader'
import { LandingHero } from './LandingHero'
import { Capabilities, FeatureCards, Integrations, ValueSections } from './LandingSections'
import { MascotIntroduction } from './MascotIntroduction'
import { ProductPreview } from './ProductPreview'
import { CARD_WIDTH } from './styles'

export function LandingPage() {
  return (
    <div id="top" className="flex min-h-dvh flex-col bg-surface text-ink">
      <LandingHeader />
      <main className="w-full px-20 sm:px-40">
        <div
          className={`${CARD_WIDTH} grid items-center gap-48 pt-56 pb-64 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-64 lg:pt-[100px] lg:pb-[112px]`}
        >
          <LandingHero />
          <ProductPreview />
        </div>
        <ValueSections />
        <FeatureCards />
        <MascotIntroduction />
        <Integrations />
        <Capabilities />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  )
}
