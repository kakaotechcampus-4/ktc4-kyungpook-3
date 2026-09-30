import type { ReactNode } from 'react'
import { Card } from '@/shared/ui/card'

export interface OnboardingCardProps {
  /** 캔버스 카드 제목 — `팀 만들기` · `디스코드 연동` … */
  title: string
  description: string
  /** 카드 본문(입력·목록). 없으면 설명 바로 아래가 버튼이다 */
  children?: ReactNode
  /** 오른쪽부터 주 버튼, 그 왼쪽이 건너뛰기 — 캔버스의 `flex-direction: row-reverse`. 대기 안내에는 없다 */
  actions?: ReactNode
}

const TITLE = 'text-[15px] font-bold tracking-h3 text-ink'

const DESCRIPTION = 'text-[13px] leading-[1.65] text-dim'

/** 단계 카드 한 장. Card 의 onboarding 변형(반경 10 · 22/22/18) 위에 제목·설명·본문·버튼 줄을 쌓는다 */
export function OnboardingCard({ title, description, children, actions }: OnboardingCardProps) {
  return (
    <Card variant="onboarding" as="section" aria-label={title} className="flex flex-col gap-8">
      <h2 className={TITLE}>{title}</h2>
      <p className={DESCRIPTION}>{description}</p>
      {children}
      {actions === undefined ? null : (
        <div className="flex flex-row-reverse items-center gap-4 pt-8">{actions}</div>
      )}
    </Card>
  )
}
