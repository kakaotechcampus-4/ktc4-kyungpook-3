import { useId } from 'react'
import type { ReactNode } from 'react'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { BrandMark } from '@/shared/ui/brand-mark'
import { Mascot } from '@/shared/ui/mascot'
import type { MascotPose } from '@/shared/ui/mascot'
import {
  ASIDE,
  ASIDE_CAPTION,
  ASIDE_DESCRIPTION,
  ASIDE_TEXT,
  ASIDE_TITLE,
  COLUMN,
  HEADING,
  HEADING_ROW,
  ROW,
  SCREEN,
} from './styles'

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
          {/* 화면에 들어온 시작점이다. 시작하기 스플래시가 걷히면 포커스가 여기로 온다(data-focus-start, #510) */}
          <h2 id={formHeadingId} tabIndex={-1} data-focus-start="" className="sr-only">
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
