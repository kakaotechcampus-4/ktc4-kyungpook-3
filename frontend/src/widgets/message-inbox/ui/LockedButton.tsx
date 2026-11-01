import { Button } from '@/shared/ui/button'
import type { ButtonProps } from '@/shared/ui/button'

export interface LockedButtonProps extends Omit<ButtonProps, 'disabled' | 'loading' | 'onClick'> {
  /** 지금은 누를 수 없다. 포커스는 남는다 */
  locked: boolean
  onClick: () => void
}

/**
 * 포커스를 남기는 잠금 버튼 — `disabled` 를 걸면 누른 버튼에서 포커스가 빠져 BODY 로 떨어진다(WCAG 2.4.3).
 * 그래서 `aria-disabled` 로 잠긴 것을 알리고, 잠긴 동안의 누름은 버린다
 * (`Button` 의 「포커스를 남겨야 하는 비활성은 `disabled` 대신 `aria-disabled`」)
 */
export function LockedButton({ locked, onClick, ...rest }: LockedButtonProps) {
  return (
    <Button
      {...rest}
      aria-disabled={locked || undefined}
      onClick={() => {
        if (!locked) onClick()
      }}
    />
  )
}
