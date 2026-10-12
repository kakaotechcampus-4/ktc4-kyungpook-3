import * as RadixPopover from '@radix-ui/react-popover'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

/*
 * Radix Popover 에 시각만 입힌다 (D-113). 동작 — 트리거의 aria-expanded · aria-controls, 열 때 안으로 포커스,
 * Esc · 바깥 누르기로 닫기, 닫을 때 트리거로 포커스 복귀 — 는 전부 Radix 가 한다. 이 파일은 그 동작을 바꾸지 않는다.
 * 면은 DropdownMenu 와 같은 떠 있는 면(반경 14 · 테두리 한 겹 · 그림자 없음, §3-④)이다. 폭은 내용이 정하고 292px 를 넘지 않는다.
 */

export const Popover = RadixPopover.Root

export const PopoverTrigger = RadixPopover.Trigger

const CONTENT =
  'z-100 flex max-w-[292px] flex-col gap-10 rounded-[14px] border border-line bg-surface p-14 text-ink'

export interface PopoverContentProps extends ComponentPropsWithoutRef<typeof RadixPopover.Content> {
  children: ReactNode
}

/** 트리거 왼쪽 끝에 맞춰 10px 아래에 연다. body 로 portal 한다. Radix 의 역할은 dialog 라 `aria-label` 로 이름을 준다 */
export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 10,
  children,
  ...rest
}: PopoverContentProps) {
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={16}
        className={[CONTENT, className].filter(Boolean).join(' ')}
        {...rest}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  )
}
