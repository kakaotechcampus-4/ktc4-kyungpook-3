import { createContext, useContext } from 'react'
import type { ComponentPropsWithoutRef } from 'react'
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import type { ToggleGroupSingleProps } from '@radix-ui/react-toggle-group'
import { ITEM, ITEM_SIZE, TRACK } from './styles'
import type { SegmentedSize } from './styles'

export type { SegmentedSize } from './styles'

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

/* 두 묶음은 겹치는 속성이 없다 — 한 번에 하나만 붙는다.
   hover 를 미선택에만 거는 이유는 docs/impl-decision/2026-09-16-segmented-hover-pressed.md
   누르는 동안 면은 바뀌지 않는다 — docs/impl-decision/2026-09-23-no-pressed-face-checkbox-segmented.md */
const ITEM_TONE = {
  default:
    'text-sub data-[state=on]:bg-surface data-[state=on]:text-ink data-[state=off]:hover:text-ink',
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
