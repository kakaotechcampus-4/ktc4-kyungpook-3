import type { ReactNode } from 'react'
import { BrandMark } from '@/shared/ui/brand-mark'
import { Mascot } from '@/shared/ui/mascot'
import type { AuthShellProps } from './AuthShell'
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

export interface AuthShellSkeletonProps extends Pick<AuthShellProps, 'title' | 'aside'> {
  /** 폼 자리의 뼈대 */
  children: ReactNode
}

/**
 * 인증 화면 코드·세션 확인을 기다리는 라우트 뼈대 (#510). AuthShell 과 같은 틀·제목·카드다 — 화면이 뜰 때 제목과 카드가 움직이지 않는다.
 * 틀이 가운데 정렬이라 폼 칸의 높이도 같아야 한다. 폼 뼈대(features/auth 의 *FormSkeleton)가 그 높이를 맞춘다.
 * 정해진 글자도 자리표시라 스크린리더에서 뺀다. 기다림은 바깥 main 의 aria-busy 가 알린다
 */
export function AuthShellSkeleton({ title, aside, children }: AuthShellSkeletonProps) {
  return (
    <main aria-busy="true" className={SCREEN}>
      <div aria-hidden="true" className={ROW}>
        <div className={COLUMN}>
          <div className={HEADING_ROW}>
            <span className="inline-flex">
              <BrandMark size="lg" />
            </span>
            <p className={HEADING}>{title}</p>
          </div>
          {children}
        </div>
        <div className={ASIDE}>
          <Mascot pose={aside.pose} size={148} />
          <div className={ASIDE_TEXT}>
            <p className={ASIDE_TITLE}>{aside.title}</p>
            <p className={ASIDE_DESCRIPTION}>{aside.description}</p>
          </div>
          <span className={ASIDE_CAPTION}>{aside.caption}</span>
        </div>
      </div>
    </main>
  )
}
