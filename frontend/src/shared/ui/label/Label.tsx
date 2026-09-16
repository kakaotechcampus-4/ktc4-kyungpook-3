import type { ComponentPropsWithoutRef } from 'react'

export type LabelTone = 'product' | 'onboarding' | 'auth'

export interface LabelProps extends ComponentPropsWithoutRef<'label'> {
  /** 화면군. 기본 'product' */
  tone?: LabelTone
  /** true 면 글자가 강조색이 된다 — "비우면 승인이 막히는 입력"에만 */
  blocking?: boolean
}

/* 12px · 13px 는 타이포 스케일 밖이다 — docs/error/2026-09-16-values-outside-token-scale.md */
const TONE_SIZE: Record<LabelTone, string> = {
  product: 'text-[12px]',
  onboarding: 'text-[12px]',
  auth: 'text-[13px]',
}

const TONE_COLOR: Record<LabelTone, string> = {
  product: 'text-sub',
  onboarding: 'text-dim',
  auth: 'text-dim',
}

/**
 * 필드 라벨. 네이티브 `<label htmlFor>` 이 포커스를 넘긴다 (§7-0).
 *
 * **굵기는 400 하나뿐이다.** 4개 화면군 실측이 전부 400이고, design-system.md §4-1 의
 * "버튼·라벨·배지 13/600" 은 배지·버튼을 말한다. 여기에 600 을 섞지 않는다.
 *
 * 문구는 `children` 으로 받는다 — 라벨 텍스트를 컴포넌트에 넣지 않는다.
 */
export function Label({ tone = 'product', blocking, className, children, ...rest }: LabelProps) {
  const classes = [
    'block font-normal',
    TONE_SIZE[tone],
    // 색은 한 곳에서만 고른다 — 두 색 클래스를 같이 붙이면 CSS 순서가 이긴다
    blocking ? 'text-accent' : TONE_COLOR[tone],
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <label className={classes} {...rest}>
      {children}
    </label>
  )
}
