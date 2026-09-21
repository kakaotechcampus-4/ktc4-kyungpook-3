import { createContext, useContext } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import type { ToggleGroupSingleProps } from '@radix-ui/react-toggle-group'

export type SegmentedSize = 'sm' | 'md'

export interface SegmentedProps extends Omit<
  ToggleGroupSingleProps,
  'type' | 'value' | 'onValueChange' | 'defaultValue'
> {
  /** 항상 하나가 선택돼 있다 — 제어 컴포넌트로만 쓴다 */
  value: string
  onValueChange: (value: string) => void
  /** 기본 'sm'. 'md' 는 탭이 2개뿐인 `Upload` 값이다 */
  size?: SegmentedSize
  /** 필수. 문구는 호출자가 준다 */
  'aria-label': string
}

export type SegmentedItemProps = ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>

/* 표는 모듈 스코프에 둔다 — 렌더마다 다시 만들지 않는다.
   근거: m2-design-tokens.md §7-7 (아트보드 5장 실측이 전부 같다) */

const TRACK = 'inline-flex gap-3 rounded-11 border border-transparent bg-control p-3'

/* `min-h-36` 을 빼면 시안보다 6px 낮아진다 — 인라인 `height`와 `min-height`가 함께 있고
   렌더 높이는 36px 이다 (§7-7). 두 값을 같이 옮긴다. */
const ITEM =
  'inline-flex min-h-36 items-center justify-center rounded-9 border-0 bg-transparent font-semibold'

const ITEM_SIZE: Record<SegmentedSize, string> = {
  sm: 'h-30 px-13 text-caption',
  md: 'h-32 px-15 text-control',
}

/* 두 묶음은 겹치는 속성이 없다 — 한 번에 하나만 붙는다.
   hover / pressed 를 미선택에만 거는 이유는 docs/impl-decision/2026-09-16-segmented-hover-pressed.md */
const ITEM_TONE = {
  default:
    'text-sub data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=off]:hover:text-ink data-[state=off]:active:bg-surface-sunken',
  disabled: 'pointer-events-none text-line-strong data-[state=on]:bg-surface',
}

/** 크기는 트랙이 정하고 항목이 읽는다 — 호출부가 항목마다 다시 적지 않게 한다 */
const SegmentedSizeContext = createContext<SegmentedSize>('sm')

/**
 * `@radix-ui/react-toggle-group` 의 `Root type="single"` (§7-0 · §7-7).
 *
 * **밑줄형 필터 탭이 아니다.** 시안의 `전체 / 확인 필요 / 진행 중 / 완료` 는 다른 컴포넌트다 (§7-7).
 *
 * `type="single"` 은 선택된 항목을 다시 누르면 빈 문자열을 보낸다.
 * 세그먼트는 항상 하나가 선택돼 있어야 하므로 빈 문자열을 무시한다.
 */
export function Segmented({
  value,
  onValueChange,
  size = 'sm',
  className,
  children,
  ...rest
}: SegmentedProps) {
  function handleValueChange(next: string) {
    if (next !== '') {
      onValueChange(next)
    }
  }

  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={handleValueChange}
      className={[TRACK, className].filter(Boolean).join(' ')}
      {...rest}
    >
      <SegmentedSizeContext.Provider value={size}>{children}</SegmentedSizeContext.Provider>
    </ToggleGroupPrimitive.Root>
  )
}

/** 항목 하나. 크기는 `Segmented` 에서 내려온다 */
export function SegmentedItem({ disabled, className, children, ...rest }: SegmentedItemProps) {
  const size = useContext(SegmentedSizeContext)
  const tone = disabled ? 'disabled' : 'default'

  return (
    <ToggleGroupPrimitive.Item
      disabled={disabled}
      className={[ITEM, ITEM_SIZE[size], ITEM_TONE[tone], className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
}
