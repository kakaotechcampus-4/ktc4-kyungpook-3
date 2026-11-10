import { HERO_SIZE, LINK_PRIMARY, LINK_SECONDARY } from './styles'
import { StartLink } from './StartLink'

export function LandingHero() {
  return (
    <section className="flex min-w-0 flex-col items-start">
      <h1 className="text-[clamp(38px,4.5vw,64px)] leading-[1.14] font-bold tracking-h3 text-ink">
        회의에서 나온 일을,
        <br />
        팀의 다음 행동으로.
      </h1>
      <p className="mt-28 max-w-[470px] text-[17px] leading-[30px] text-dim sm:text-lead sm:leading-[32px]">
        회의록을 고치고, 결정된 일을 태스크로 이어 보세요. 담당자와 마감부터 팀의 답장까지 한곳에서
        함께 확인합니다.
      </p>
      <div className="mt-32 flex flex-wrap gap-10">
        <StartLink className={`${LINK_PRIMARY} ${HERO_SIZE}`}>시작하기</StartLink>
        <a href="#product" className={`${LINK_SECONDARY} ${HERO_SIZE}`}>
          제품 살펴보기
        </a>
      </div>
      <p className="mt-18 flex items-start gap-8 text-[12px] leading-[20px] text-dim sm:text-[13px]">
        <span aria-hidden="true" className="mt-7 h-6 w-6 shrink-0 rounded-999 bg-accent-solid" />
        Notion·Discord 연동 없이 웹에서 먼저 시작할 수 있어요.
      </p>
    </section>
  )
}
