import { useId } from 'react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'

export type CheckboxState = boolean | 'indeterminate'

export interface CheckboxProps extends ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  /** 약관 미체크처럼 승인을 막는 입력에만. 테두리가 강조색이 된다 */
  invalid?: boolean
  /** 라벨. 문구는 호출자가 준다 — 법적 고지 문구를 컴포넌트에 넣지 않는다 */
  children?: ReactNode
}

/* 표는 모듈 스코프에 둔다 — 렌더마다 다시 만들지 않는다.
   근거: m2-design-tokens.md §7-5, docs/impl-decision/2026-09-16-no-cn-clsx-tailwind-merge.md */

/** 라벨 붙은 행 실측 (`Signup.dc.html`) — gap 10 · padding-top 2 · 체크박스 margin-top 1 */
const ROW = 'flex items-start gap-10 pt-2'

const BOX = 'mt-1 inline-flex h-18 w-18 shrink-0 items-center justify-center rounded-6 border'

/* 면은 data-state 가 고른다. 호출부가 uncontrolled 로 써도 맞아야 하기 때문이다.
   같은 속성 안에서 기본 유틸과 변형 유틸이 겹치면 변형이 이긴다 (Tailwind 생성 순서). */
const BOX_SURFACE =
  'bg-surface data-[state=checked]:border-transparent data-[state=checked]:bg-ink data-[state=checked]:active:bg-sub data-[state=indeterminate]:border-transparent data-[state=indeterminate]:bg-ink data-[state=indeterminate]:active:bg-sub'

/** 미체크 테두리는 "입력 경계"다 — docs/impl-decision/2026-09-16-checkbox-unchecked-border.md */
const BOX_BORDER =
  'border-input-border data-[state=unchecked]:hover:border-ink data-[state=unchecked]:active:border-ink'

const BOX_BORDER_INVALID = 'border-accent'

/** 비활성은 면이 비활성 표식 한 단이다. 미체크만 테두리가 남는다 */
const BOX_DISABLED = 'border-transparent bg-inactive data-[state=unchecked]:border-line-strong'

type CheckboxTone = 'default' | 'invalid' | 'disabled'

const BOX_TONE: Record<CheckboxTone, string> = {
  default: `${BOX_SURFACE} ${BOX_BORDER}`,
  invalid: `${BOX_SURFACE} ${BOX_BORDER_INVALID}`,
  disabled: BOX_DISABLED,
}

/* 13px / 20px 는 타이포 스케일 밖이다 — docs/impl-decision/2026-09-16-values-outside-token-scale.md */
const LABEL = 'cursor-pointer text-[13px] leading-[20px] font-normal text-dim'

const INDICATOR = 'inline-flex items-center justify-center text-surface'

/** 9×2 흰 막대 — indeterminate 표식 */
const BAR = 'h-2 w-9 rounded-999 bg-surface'

/**
 * `@radix-ui/react-checkbox` 의 `Root` + `Indicator` (§7-0 · §7-5).
 *
 * 체크 표식은 시안의 커스텀 SVG 그대로다 — 11×11 · `stroke-width 3.2` · `m20 6-11 11-5-5`.
 * 색은 `stroke="currentColor"` 로 받아 `text-surface` 한 곳에서만 고른다 (TSX 에 hex 를 적지 않는다).
 *
 * `indeterminate` 는 `checked="indeterminate"` 로만 들어온다 — `defaultChecked` 로는 만들 수 없다.
 * 그래서 표식은 `checked` prop 으로 고른다.
 *
 * `invalid` 는 **비우면 승인이 막히는 체크박스**에만 쓴다 (약관 동의). 일반 검증 실패에 쓰지 않는다.
 */
export function Checkbox({
  checked,
  disabled,
  invalid,
  id,
  className,
  children,
  ...rest
}: CheckboxProps) {
  const generatedId = useId()
  const fieldId = id ?? generatedId

  const tone: CheckboxTone = disabled ? 'disabled' : invalid ? 'invalid' : 'default'

  return (
    <div className={[ROW, className].filter(Boolean).join(' ')}>
      <CheckboxPrimitive.Root
        id={fieldId}
        checked={checked}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        className={[BOX, BOX_TONE[tone]].join(' ')}
        {...rest}
      >
        <CheckboxPrimitive.Indicator className={INDICATOR}>
          {checked === 'indeterminate' ? (
            <span className={BAR} />
          ) : (
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m20 6-11 11-5-5" />
            </svg>
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>

      {children ? (
        <label htmlFor={fieldId} className={LABEL}>
          {children}
        </label>
      ) : null}
    </div>
  )
}
