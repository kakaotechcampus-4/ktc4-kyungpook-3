import { Button } from '@/shared/ui/button'
import type { ButtonProps, ButtonVariant } from '@/shared/ui/button'

export interface LockedButtonProps extends Omit<ButtonProps, 'disabled' | 'loading' | 'onClick'> {
  /** 지금은 누를 수 없다. 포커스는 남는다 */
  locked: boolean
  /**
   * 잠겨도 모양을 바꾸지 않는다 — 이유를 다른 자리가 보여 주는 짧은 잠금(발송 시점 저장)에서 버튼이 깜빡이지 않게 한다.
   * 잠금은 그대로 `aria-disabled` 로 알리고 누름도 버린다. 사람이 이유를 알아야 하는 잠금에는 쓰지 않는다
   */
  keepLook?: boolean
  onClick: () => void
}

/* 잠겨도 모양을 바꾸지 않는 변형의 면·글자·hover·포커스 선 — `Button` 의 VARIANT 기본값을 aria-disabled 위에 다시 건다.
   `data-lock="quiet"` 가 선택자를 `Button` 의 `aria-disabled:` 규칙보다 구체적으로 만든다(CSS 순서에 기대지 않는다).
   메시지 화면이 쓰는 변형만 둔다. `Button` 의 VARIANT 를 바꾸면 여기도 같이 바꾼다 */
const KEEP_LOOK: Partial<Record<ButtonVariant, string>> = {
  primary:
    'data-[lock=quiet]:aria-disabled:bg-ink data-[lock=quiet]:aria-disabled:text-surface data-[lock=quiet]:aria-disabled:hover:bg-dim data-[lock=quiet]:aria-disabled:focus-visible:outline-surface data-[lock=quiet]:aria-disabled:focus-visible:-outline-offset-3',
  default:
    'data-[lock=quiet]:aria-disabled:bg-control data-[lock=quiet]:aria-disabled:text-ink data-[lock=quiet]:aria-disabled:hover:bg-line-strong',
  ghost: 'data-[lock=quiet]:aria-disabled:text-sub',
}

/**
 * 포커스를 남기는 잠금 버튼 — `disabled` 를 걸면 누른 버튼에서 포커스가 빠져 BODY 로 떨어진다(WCAG 2.4.3).
 * 그래서 `aria-disabled` 로 잠긴 것을 알리고, 잠긴 동안의 누름은 버린다
 * (`Button` 의 「포커스를 남겨야 하는 비활성은 `disabled` 대신 `aria-disabled`」)
 */
export function LockedButton({
  locked,
  keepLook = false,
  onClick,
  variant = 'default',
  className,
  ...rest
}: LockedButtonProps) {
  const quiet = locked && keepLook
  return (
    <Button
      {...rest}
      variant={variant}
      className={quiet ? [KEEP_LOOK[variant], className].filter(Boolean).join(' ') : className}
      data-lock={quiet ? 'quiet' : undefined}
      aria-disabled={locked || undefined}
      onClick={() => {
        if (!locked) onClick()
      }}
    />
  )
}
