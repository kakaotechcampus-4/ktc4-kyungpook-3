import { useId } from 'react'
import type { ReactNode } from 'react'
import { paths } from '@/shared/config/routes'
import { useCompactScreen } from '@/shared/lib/compact-screen'
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
  FORM_SLOT,
  HEADING,
  HEADING_ROW,
  PHONE_BRAND,
  PHONE_COLUMN,
  PHONE_FORM,
  PHONE_HEADING,
  PHONE_INTRO,
  PHONE_MASCOT_SIZE,
  PHONE_ROW,
  PHONE_SCREEN,
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
  /**
   * 있으면 휴대폰 폭(768px 미만)에서 시안 H-1 배치로 그린다. 매스·제목 아래의 한 줄 소개다.
   * 없으면 휴대폰에서도 넓은 화면과 같은 한 열이다(회원가입)
   */
  phoneIntro?: string
  children: ReactNode
}

function HiddenFormHeading({ id, label }: { id: string; label: string }) {
  // 스크린리더가 제목 목록에서 이 화면을 찾는 이름이다. 보이는 제목은 캔버스 그대로 둔다
  // 화면에 들어온 시작점이다. 시작하기 스플래시가 걷히면 포커스가 여기로 온다(data-focus-start, #510)
  return (
    <h2 id={id} tabIndex={-1} data-focus-start="" className="sr-only">
      {label}
    </h2>
  )
}

function LandingLink({ children }: { children: ReactNode }) {
  return (
    <GuardedLink to={paths.landing()} aria-label="Manager's Manager" className="inline-flex">
      {children}
    </GuardedLink>
  )
}

/**
 * 로그인·회원가입의 두 칸 틀. 왼쪽이 제목과 폼, 오른쪽이 매스와 안내 카드다.
 * 휴대폰 로그인(H-1)은 같은 요소에 클래스와 제목 묶음만 바꾼다. 폼(children)의 부모 종류와 자리가 같아야
 * 폭이 768px 를 넘나들어도 폼이 다시 마운트되지 않고 입력값·오류·한 번 읽은 카카오 안내가 남는다
 */
export function AuthShell({ title, formLabel, aside, phoneIntro, children }: AuthShellProps) {
  const formHeadingId = useId()
  const phone = useCompactScreen() && phoneIntro !== undefined
  return (
    <main className={phone ? PHONE_SCREEN : SCREEN}>
      <div className={phone ? PHONE_ROW : ROW}>
        <section aria-labelledby={formHeadingId} className={phone ? PHONE_COLUMN : COLUMN}>
          {phone ? (
            <div className={PHONE_BRAND}>
              <LandingLink>
                <Mascot pose={aside.pose} size={PHONE_MASCOT_SIZE} />
              </LandingLink>
              <h1 className={PHONE_HEADING}>{title}</h1>
              <p className={PHONE_INTRO}>{phoneIntro}</p>
            </div>
          ) : (
            <div className={HEADING_ROW}>
              <LandingLink>
                <BrandMark size="lg" />
              </LandingLink>
              <h1 className={HEADING}>{title}</h1>
            </div>
          )}
          <HiddenFormHeading id={formHeadingId} label={formLabel} />
          <div className={phone ? PHONE_FORM : FORM_SLOT}>{children}</div>
        </section>
        {phone ? null : (
          <aside className={ASIDE}>
            <Mascot pose={aside.pose} size={148} label="매스" />
            <div className={ASIDE_TEXT}>
              <p className={ASIDE_TITLE}>{aside.title}</p>
              <p className={ASIDE_DESCRIPTION}>{aside.description}</p>
            </div>
            <span className={ASIDE_CAPTION}>{aside.caption}</span>
          </aside>
        )}
      </div>
    </main>
  )
}
