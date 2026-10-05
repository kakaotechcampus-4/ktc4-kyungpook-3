import * as RadixMenu from '@radix-ui/react-dropdown-menu'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

/*
 * Radix Dropdown Menu 에 시각만 입힌다 (D-113). 동작 — 화살표 키 이동, Home/End, 글자 검색, Esc 닫기,
 * 닫을 때 트리거로 포커스 복귀 — 는 전부 Radix 가 한다. 이 파일은 그 동작을 바꾸지 않는다.
 * 값은 Main 캔버스의 팀 메뉴(.team-menu · .team-row) 실측이다. 그림자는 쓰지 않는다 (§3-④).
 */

export const DropdownMenu = RadixMenu.Root

export const DropdownMenuTrigger = RadixMenu.Trigger

/** 292px · padding 8 · 반경 14 · 항목 간격 1 */
const CONTENT =
  'z-100 flex w-[292px] flex-col gap-1 rounded-[14px] border border-line bg-surface p-8 text-ink'

export interface DropdownMenuContentProps extends ComponentPropsWithoutRef<
  typeof RadixMenu.Content
> {
  children: ReactNode
}

/** 트리거 오른쪽 끝에 맞춰 10px 아래에 연다. body 로 portal 한다 */
export function DropdownMenuContent({
  className,
  align = 'end',
  sideOffset = 10,
  children,
  ...rest
}: DropdownMenuContentProps) {
  return (
    <RadixMenu.Portal>
      <RadixMenu.Content
        align={align}
        sideOffset={sideOffset}
        className={[CONTENT, className].filter(Boolean).join(' ')}
        {...rest}
      >
        {children}
      </RadixMenu.Content>
    </RadixMenu.Portal>
  )
}

/** 한 줄 — 반경 10 · 9/10 · 간격 10. 키보드로 고른 줄(data-highlighted)과 hover 가 같은 선택 면이다 */
const ITEM =
  'flex w-full cursor-pointer items-center gap-10 rounded-10 px-10 py-9 text-left outline-none select-none data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[highlighted]:bg-surface-selected'

export type DropdownMenuItemProps = ComponentPropsWithoutRef<typeof RadixMenu.Item>

export function DropdownMenuItem({ className, ...rest }: DropdownMenuItemProps) {
  return <RadixMenu.Item className={[ITEM, className].filter(Boolean).join(' ')} {...rest} />
}

/** `내 팀 3` 같은 묶음 제목. 10.5px · 대문자 간격 0.1em · 흐림 */
const LABEL = 'px-10 py-5 text-[10.5px] tracking-[0.1em] text-dim uppercase'

export type DropdownMenuLabelProps = ComponentPropsWithoutRef<typeof RadixMenu.Label>

export function DropdownMenuLabel({ className, ...rest }: DropdownMenuLabelProps) {
  return <RadixMenu.Label className={[LABEL, className].filter(Boolean).join(' ')} {...rest} />
}

/** 1px 구분선 · 위아래 6 · 좌우 4 */
const SEPARATOR = 'mx-4 my-6 h-1 bg-divider'

export function DropdownMenuSeparator() {
  return <RadixMenu.Separator className={SEPARATOR} />
}

export const DropdownMenuGroup = RadixMenu.Group
