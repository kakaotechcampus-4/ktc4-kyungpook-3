import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { HERO_SIZE, LINK_PRIMARY, LINK_SECONDARY, TEXT_WIDTH } from './styles'

const SECTION = `${TEXT_WIDTH} flex flex-col items-center gap-28 pt-72`

const INTRO =
  'inline-flex h-32 items-center gap-8 rounded-999 border border-line bg-surface px-16 text-body leading-none text-ink'

const TITLE = 'max-w-[900px] text-center text-[60px] leading-[60px] font-bold tracking-h3 text-ink'

const LEAD = 'max-w-[660px] text-center text-lead leading-[29px] text-dim'

/**
 * 히어로. `시작하기` → 로그인 (D-003). `1분 데모 보기` 는 넣지 않는다 (D-002).
 * `살펴보기` 는 바로 아래 제품 미리보기로 내려간다.
 */
export function LandingHero() {
  return (
    <section className={SECTION}>
      <a href="#values" className={INTRO}>
        Manager&apos;s Manager<span className="text-dim">·</span>
        <span className="text-dim">소개 글 읽기</span>
      </a>
      <h1 className={TITLE}>
        한 번의 클릭으로,
        <br />
        매니저가 정리합니다
      </h1>
      <p className={LEAD}>
        회의 녹음을 올리면 결정사항과 담당자, 마감을 정리해 Notion에 반영하고 담당자에게 Discord로
        알립니다. 확인이 필요한 것만 골라 드려요.
      </p>
      <div className="flex items-center gap-10 pt-4">
        <GuardedLink to={paths.login()} className={`${LINK_PRIMARY} ${HERO_SIZE}`}>
          시작하기
        </GuardedLink>
        <a href="#product" className={`${LINK_SECONDARY} ${HERO_SIZE}`}>
          살펴보기
        </a>
      </div>
    </section>
  )
}
