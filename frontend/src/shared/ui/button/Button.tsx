import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'text' | 'outline'

export type ButtonSize =
  | 'sm'
  | 'md'
  | 'md-compact'
  | 'lg'
  | 'lg-onboarding'
  | 'xl'
  | 'auth'
  | 'landing-hero'
  | 'landing-nav'

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  /** 시각 변형. 기본 'default' */
  variant?: ButtonVariant
  /** 화면군별 크기. 기본 'md' */
  size?: ButtonSize
  /** 인증 폼처럼 폭을 꽉 채우는 자리에 쓴다 */
  fullWidth?: boolean
  /** true 면 disabled + aria-busy. 스피너는 그리지 않는다 */
  loading?: boolean
  startIcon?: ReactNode
  endIcon?: ReactNode
}

/* 표는 모듈 스코프에 둔다 — 렌더마다 다시 만들지 않는다.
   근거: m2-design-tokens.md §7-1, docs/impl-decision/2026-09-16-no-cn-clsx-tailwind-merge.md */

const BASE = 'inline-flex items-center justify-center gap-6 whitespace-nowrap'

/* 먹 면에는 전역 먹 선이 묻힌다 — 면 안쪽에 흰 선을 긋는다.
   aria-disabled 면은 밝아서 흰 선이 안 보이므로 전역 값으로 되돌린다.
   docs/impl-decision/2026-09-23-focus-outline-over-border.md */
const INK_FACE_FOCUS =
  'focus-visible:outline-surface focus-visible:-outline-offset-3 aria-disabled:focus-visible:outline-ink aria-disabled:focus-visible:-outline-offset-1'

const VARIANT: Record<ButtonVariant, string> = {
  // 먹 면 → hover/pressed 는 같은 축에서 한 단 이동한 보조. 검정도 opacity 도 쓰지 않는다
  primary: `bg-ink text-surface hover:bg-dim hover:text-surface active:bg-sub active:text-surface disabled:bg-surface-selected disabled:text-faint aria-disabled:bg-surface-selected aria-disabled:text-faint ${INK_FACE_FOCUS}`,
  // 컨트롤 면 #EDEDED → hover 는 같은 회색 축에서 한 단 진한 강조 테두리색 #C9C9C9.
  // 차콜(#666)은 면이 바뀌는 느낌이 나서 쓰지 않는다.
  default:
    'border border-transparent bg-control text-ink hover:bg-line-strong active:bg-inactive disabled:bg-surface-selected disabled:text-faint aria-disabled:bg-surface-selected aria-disabled:text-faint',
  // 실측 .modal-cancel:hover = 컨트롤 면
  ghost:
    'bg-transparent text-sub hover:bg-control active:bg-line disabled:text-line-strong aria-disabled:text-line-strong',
  text: 'bg-transparent text-faint hover:text-dim active:text-sub disabled:text-line-strong aria-disabled:text-line-strong',
  // hover 면은 ghost 와 같다 (컨트롤 #EDEDED). 테두리는 유지
  outline:
    'border border-line bg-surface text-ink hover:bg-control active:bg-surface-selected disabled:border-surface-selected disabled:text-line-strong aria-disabled:border-surface-selected aria-disabled:text-line-strong',
}

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-32 rounded-9 px-12 text-control',
  md: 'h-36 rounded-9 px-20 text-control',
  'md-compact': 'h-34 rounded-9 px-13 text-caption',
  lg: 'h-40 rounded-9 px-20 text-body',
  'lg-onboarding': 'h-40 rounded-8 px-18 text-body',
  // 14.5px · 38px · 15px 는 토큰 스케일 밖이다 — docs/impl-decision/2026-09-16-values-outside-token-scale.md
  xl: 'h-44 rounded-9 px-22 text-[14.5px]',
  auth: 'h-48 w-full rounded-999 text-[15px]',
  'landing-hero': 'h-44 rounded-999 px-24 text-landing',
  'landing-nav': 'h-[38px] rounded-999 px-18 text-[15px]',
}

/**
 * 네이티브 `<button>`. Radix 를 쓰지 않는다 (§7-0).
 *
 * - **주 액션(`variant="primary"`)은 화면당 1개.** 컴포넌트가 강제할 수 없으므로 호출부가 지킨다.
 *   (승인 카드가 여럿이면 카드마다 하나로 센다.)
 * - **파괴적 빨강 채움 버튼은 만들지 않는다.** `반려`·`팀 삭제` 같은 액션도 `ghost` 또는 `default` 로 그린다.
 * - 포커스를 남겨야 하는 비활성은 `disabled` 대신 `aria-disabled` 를 넘긴다.
 * - 온보딩 카드 안의 확정 버튼(`size="lg-onboarding"` + `variant="primary"`)만 700 이다.
 *   하단 내비의 `다음` 은 600 이라 이 표로 덮지 못한다 —
 *   docs/impl-decision/2026-09-16-button-size-table-vs-variant.md
 */
export function Button({
  variant = 'default',
  size = 'md',
  fullWidth,
  loading,
  startIcon,
  endIcon,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  // 굵기는 한 곳에서만 고른다 — font-semibold 와 font-bold 를 같이 붙이면 CSS 순서가 이긴다
  const weight = size === 'lg-onboarding' && variant === 'primary' ? 'font-bold' : 'font-semibold'

  const classes = [
    BASE,
    VARIANT[variant],
    SIZE[size],
    weight,
    fullWidth ? 'w-full' : undefined,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {startIcon}
      {children}
      {endIcon}
    </button>
  )
}
