import { useId } from 'react'
import { Mascot } from '@/shared/ui/mascot'
import { CARD_WIDTH, SECTION_LEAD, SECTION_TITLE } from './styles'

export function MascotIntroduction() {
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      className={`${CARD_WIDTH} mb-64 grid items-center gap-32 border-y border-line py-48 sm:mb-96 sm:py-64 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-64`}
    >
      <div className="min-w-0">
        <h2 id={titleId} className={SECTION_TITLE}>
          함께 일할 매스예요.
        </h2>
        <p className={`${SECTION_LEAD} mt-22 max-w-[620px]`}>
          Manager&apos;s Manager의 마스코트, 매스예요. 작은 타이머를 닮은 모습으로 서비스 곳곳에서
          만날 수 있어요.
        </p>
        <p className={`${SECTION_LEAD} mt-12 max-w-[620px]`}>
          서비스를 시작할 때, 회의 정리를 기다릴 때, 확인할 메시지를 살펴볼 때 함께합니다.
        </p>
      </div>
      <div className="flex justify-center pt-16 lg:order-first">
        <Mascot
          size={280}
          palette="ink"
          pose="idle"
          label="마스코트 매스"
          className="h-[200px] w-[200px] lg:h-[280px] lg:w-[280px]"
        />
      </div>
    </section>
  )
}
