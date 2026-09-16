import type { ComponentPropsWithoutRef, ElementType } from 'react'

export type CardVariant = 'default' | 'attention' | 'pending' | 'onboarding'

export type CardAs = 'div' | 'article' | 'section' | 'label'

export interface CardProps extends ComponentPropsWithoutRef<'div'> {
  /** 시각 변형. 기본 'default' */
  variant?: CardVariant
  /** 그릴 태그. 기본 'div' — Tasks 는 article, Settings 선택 카드는 label */
  as?: CardAs
}

/* 표는 모듈 스코프에 둔다 — 렌더마다 다시 만들지 않는다.
   근거: m2-design-tokens.md §7-4, docs/error/2026-09-16-no-cn-clsx-tailwind-merge.md */

/** 네 변형 모두 흰 면이다. 눌린 면은 Panel 쪽이다. */
const BASE = 'bg-surface'

/* padding 은 변형마다 대표값 하나로 접었다 —
   docs/error/2026-09-16-card-padding-representative.md

   `border-dashed` 는 한 이름이 두 규칙을 낸다 — 모양(dashed)과 --color-dashed 색.
   색 클래스를 따로 붙이지 않는다 — docs/error/2026-09-16-border-dashed-name-collision.md */
const VARIANT: Record<CardVariant, string> = {
  default: 'rounded-16 border border-line px-20 py-18',
  attention: 'rounded-16 border border-line-strong px-30 py-28',
  pending: 'rounded-16 border-2 border-dashed px-22 py-20',
  onboarding: 'rounded-10 border border-line px-22 pt-22 pb-18',
}

/**
 * 카드 한 겹. 네이티브 태그만 쓴다 (§7-0).
 *
 * **그림자를 넣지 않는다.** 시안의 `attention` 은 짙은 그림자를 같이 쓰지만 §3-④ 가 그것을 막는다.
 * "지금 봐야 하는 카드"는 `border-line-strong` 테두리 한 단만으로 낸다.
 *
 * **반경 28 은 여기 없다.** 인증 화면 우측 사이드 카드(`Login` `Signup`)의 일회성 값이라
 * M4 에서 그 화면이 직접 쓴다 (§7-4).
 *
 * `as="label"` 로 그릴 때 `htmlFor` 나 안쪽 입력은 호출부가 붙인다 — 이 컴포넌트는 묶지 않는다.
 */
export function Card({ variant = 'default', as = 'div', className, children, ...rest }: CardProps) {
  /* 네 태그 모두 HTMLElement 라 div 속성 하나로 덮는다 — §7-4 의 CardProps 가 그렇게 적혀 있다.
     label 전용 htmlFor 는 호출부가 붙인다 (`as="label"` 은 Settings 선택 카드용). */
  const Tag = as as ElementType<ComponentPropsWithoutRef<'div'>>

  const classes = [BASE, VARIANT[variant], className].filter(Boolean).join(' ')

  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  )
}
