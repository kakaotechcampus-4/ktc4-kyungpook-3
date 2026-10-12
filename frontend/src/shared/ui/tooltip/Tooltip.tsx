import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

/*
 * Radix Tooltip 에 시각만 입힌다 (D-113). 동작 — 가리키면 잠깐 뒤 열기, 키보드 포커스로 바로 열기, Esc · 포커스 잃기 ·
 * 누르기로 닫기, 떠 있는 면 위로 포인터를 옮겨도 열린 채 두기(WCAG 1.4.13) — 는 전부 Radix 가 한다. 이 파일은 그 동작을 바꾸지 않는다.
 * 면은 Popover · DropdownMenu 와 같은 떠 있는 면(테두리 한 겹 · 그림자 없음, §3-④)이다. 폭은 트리거 폭을 넘지 않는다 —
 * 잘린 글을 그 아래에 접어서 다 보인다. Provider 를 툴팁마다 둔다 — 앱 전체에 툴팁이 하나뿐이라 공유할 지연이 없다.
 */

export interface TooltipProps extends ComponentPropsWithoutRef<typeof RadixTooltip.Root> {
  children: ReactNode
}

export function Tooltip({ children, ...rest }: TooltipProps) {
  return (
    <RadixTooltip.Provider>
      <RadixTooltip.Root {...rest}>{children}</RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}

export const TooltipTrigger = RadixTooltip.Trigger

const CONTENT =
  'z-100 max-w-(--radix-tooltip-trigger-width) rounded-9 border border-line bg-surface px-12 py-8 text-control text-ink'

export interface TooltipContentProps extends ComponentPropsWithoutRef<typeof RadixTooltip.Content> {
  children: ReactNode
}

/** 트리거 왼쪽 끝에 맞춰 6px 아래에 연다. body 로 portal 한다 */
export function TooltipContent({
  className,
  align = 'start',
  sideOffset = 6,
  children,
  ...rest
}: TooltipContentProps) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={16}
        className={[CONTENT, className].filter(Boolean).join(' ')}
        {...rest}
      >
        {children}
      </RadixTooltip.Content>
    </RadixTooltip.Portal>
  )
}
