import { useId } from 'react'
import type { ReactNode } from 'react'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { BrandMark } from '@/shared/ui/brand-mark'
import { Mascot } from '@/shared/ui/mascot'
import type { MascotPose } from '@/shared/ui/mascot'

export interface AuthShellProps {
  /** 폼 위 제목 — `Manager's Manager` · `계정 만들기` */
  title: string
  /** 화면 이름 — `로그인` · `회원가입`. 캔버스 제목이 화면 이름이 아니라서 폼 칸의 숨은 제목으로 둔다 */
  formLabel: string
  /** 오른쪽 카드. 문구는 화면마다 다르다 */
  aside: {
    pose: MascotPose
    title: ReactNode
    description: ReactNode
    caption: string
  }
  children: ReactNode
}

/* Login·Signup 캔버스 실측. 88px 간격 · 384px 폼 열 · 460px 카드 · 카드 높이 468px ·
   카드 반경 28px(Card 에 없는 인증 화면 일회성 값, m2 §7-4) · 제목 32/38 · 카드 제목 24/32 · 설명 15/24 ·
   캡션 12 는 토큰 스케일 밖이라 그 자리에 임의값으로 쓴다 — docs/impl-decision/2026-09-16-values-outside-token-scale.md */
const SCREEN = 'flex min-h-dvh items-center justify-center bg-surface px-48 py-56 text-ink'

const ROW = 'flex items-center gap-[88px]'

const COLUMN = 'flex w-[384px] shrink-0 flex-col gap-24'

const HEADING_ROW = 'flex items-center justify-center gap-16'

const HEADING = 'mb-2 text-[32px] leading-[38px] font-bold tracking-h3 text-ink'

/* 1024px 에서는 460px 를 다 못 쓴다 — 카드만 줄어든다 */
const ASIDE =
  'flex h-[468px] min-w-[0px] flex-[0_1_460px] flex-col items-center justify-center gap-34 rounded-[28px] bg-surface-sunken p-44 text-center'

const ASIDE_TEXT = 'flex flex-col items-center gap-12'

const ASIDE_TITLE = 'text-[24px] leading-[32px] font-semibold tracking-h3 text-ink'

const ASIDE_DESCRIPTION = 'max-w-[320px] text-[15px] leading-[24px] text-dim'

const ASIDE_CAPTION = 'text-[12px] text-dim tabular-nums'

/** 로그인·회원가입의 두 칸 틀. 왼쪽이 제목과 폼, 오른쪽이 매스와 안내 카드다 */
export function AuthShell({ title, formLabel, aside, children }: AuthShellProps) {
  const formHeadingId = useId()
  return (
    <main className={SCREEN}>
      <div className={ROW}>
        <section aria-labelledby={formHeadingId} className={COLUMN}>
          <div className={HEADING_ROW}>
            <GuardedLink
              to={paths.landing()}
              aria-label="Manager's Manager"
              className="inline-flex"
            >
              <BrandMark size="lg" />
            </GuardedLink>
            <h1 className={HEADING}>{title}</h1>
          </div>
          {/* 스크린리더가 제목 목록에서 이 화면을 찾는 이름이다. 보이는 제목은 캔버스 그대로 둔다 */}
          <h2 id={formHeadingId} className="sr-only">
            {formLabel}
          </h2>
          {children}
        </section>
        <aside className={ASIDE}>
          <Mascot pose={aside.pose} size={148} label="매스" />
          <div className={ASIDE_TEXT}>
            <p className={ASIDE_TITLE}>{aside.title}</p>
            <p className={ASIDE_DESCRIPTION}>{aside.description}</p>
          </div>
          <span className={ASIDE_CAPTION}>{aside.caption}</span>
        </aside>
      </div>
    </main>
  )
}
