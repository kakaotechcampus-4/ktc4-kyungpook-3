import { useRef } from 'react'
import type { ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Icon } from '@/shared/ui/icon'

export interface ModalProps {
  /** 열림 상태는 호출자가 소유한다 */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 문구는 호출자가 준다. 비어도 요소 자체는 항상 그린다 */
  title: ReactNode
  description?: ReactNode
  /** 본문 커스텀 */
  children?: ReactNode
  /** 보통 ghost + primary 버튼 두 개. 문구는 호출자가 준다 */
  actions?: ReactNode
  /** 카드 폭. 기본 380 은 클래스가 준다 — 여기에 값을 주면 그 값이 덮는다 */
  width?: number
  /** 스크림과 닫기 버튼의 접근성 이름 */
  closeLabel?: string
  closeButton?: 'absolute' | 'sticky'
  closeDisabled?: boolean
  /** 카드에 덧붙인다 */
  className?: string
  /** Esc 로 닫기 전에 부른다. `preventDefault` 하면 닫지 않는다 — 창 안에서 Esc 를 스스로 쓰는 칸(그 자리 고치기)이 쓴다 */
  onEscapeKeyDown?: (event: KeyboardEvent) => void
}

/* 표는 모듈 스코프에 둔다 — 렌더마다 다시 만들지 않는다.
   근거: m2-design-tokens.md §7-8, docs/impl-decision/2026-09-16-no-cn-clsx-tailwind-merge.md */

/* `inset-[0px]` 은 tokens.css 에 `--spacing-0` 이 없어 `inset-0` 이 생성되지 않던 때의 우회다.
   그때 오버레이가 화면을 덮지 못하고 문서 흐름 아래에 떠 있었다. #497 부터는 `inset-0` 도 같은 값이다.
   docs/impl-decision/2026-09-29-modal-inset-zero.md */
const OVERLAY = 'fixed inset-[0px] z-100 flex items-center justify-center p-24'

/** 스크림은 먹의 32% 알파다. 검정이 아니다 (§5-1 금지 목록과 어긋나지 않는다) */
const SCRIM = 'absolute inset-[0px] cursor-pointer bg-ink-solid/32'

/* `relative` 는 실측표에 없지만 빠뜨릴 수 없다 — 스크림이 `absolute` 라서
   자리잡지 않은 카드는 스크림 아래로 깔린다. 쌓임 순서를 위한 한 개다. */
const CARD =
  'relative flex w-[380px] max-w-full flex-col gap-12 rounded-16 border border-line bg-surface p-24'

/* 17px 은 타이포 토큰 6종 밖이다 — docs/impl-decision/2026-09-16-modal-title-17px.md
   자간 -0.02em 은 `tracking-h3` 과 정확히 같은 값이라 임의값을 쓰지 않는다. */
const TITLE = 'text-[17px] font-bold tracking-h3 text-ink'

/* 줄 높이 1.7 은 `text-body` 토큰이 이미 달고 나온다 —
   `leading-*` 을 겹쳐 붙이면 그 1.7 을 덮어 버린다. */
const DESCRIPTION = 'text-body text-sub'

const ACTIONS = 'flex justify-end gap-8 pt-6'
const CLOSE = 'inline-flex size-32 items-center justify-center rounded-9 border-0 p-0 text-dim'

/**
 * `@radix-ui/react-dialog` 의 `Root` `Portal` `Overlay` `Content` `Title` `Description` `Close` (§7-0 · §7-8).
 *
 * **여는/닫는 전환이 없다.** 줄이기를 켜지 않은 사람에게도 없다 — 시안에 전환이 없다.
 * 그래서 이 파일에는 `transition-*` 도 `animate-*` 도 한 개도 없다.
 *
 * `Title` 은 조건 없이 그린다. 없으면 Radix 가 콘솔 경고를 낸다.
 * `description` 을 안 주면 `aria-describedby` 를 명시적으로 지운다 — 같은 이유의 두 번째 경고를 막는다.
 *
 * **닫히면 연 요소로 포커스를 돌린다.** 열림을 호출자가 쥐어 Radix `Trigger` 가 없다 — Radix 는 Trigger 로만 돌려서
 * 포커스가 `body` 로 떨어졌다. 열릴 때 포커스가 있던 요소를 기억했다가 닫힐 때 돌린다. 그 요소가 문서에서 사라졌거나
 * 닫는 사이 다른 요소(이동한 새 화면)가 포커스를 가져갔으면 손대지 않는다.
 * docs/impl-decision/2026-10-06-modal-focus-return.md
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  width,
  closeLabel = '닫기',
  closeButton,
  closeDisabled = false,
  className,
  onEscapeKeyDown,
}: ModalProps) {
  const opener = useRef<HTMLElement | null>(null)
  const close = (
    <DialogPrimitive.Close
      aria-label={closeLabel}
      disabled={closeDisabled}
      className={`${CLOSE} ${closeButton === 'sticky' ? 'absolute -top-4 -right-4 bg-surface' : 'absolute top-20 right-20 bg-transparent'}`}
    >
      <Icon name="close" size={18} strokeWidth={1.9} />
    </DialogPrimitive.Close>
  )

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={OVERLAY}>
          <DialogPrimitive.Close className={SCRIM} aria-label={closeLabel} />

          <DialogPrimitive.Content
            className={[CARD, className].filter(Boolean).join(' ')}
            style={width === undefined ? undefined : { width }}
            onEscapeKeyDown={onEscapeKeyDown}
            onOpenAutoFocus={() => {
              // FocusScope 가 첫 요소로 옮기기 전이다 — 지금 포커스가 있는 요소가 모달을 연 요소다
              const active = document.activeElement
              opener.current =
                active instanceof HTMLElement && active !== document.body ? active : null
            }}
            onCloseAutoFocus={(event) => {
              const target = opener.current
              opener.current = null
              if (target === null || !target.isConnected) return
              const active = document.activeElement
              if (active !== null && active !== document.body) return
              // Radix 의 기본 처리(Trigger 로 돌리기)를 막고 연 요소로 돌린다. 포커스를 받을 수 없으면 그대로 body 다
              event.preventDefault()
              target.focus()
            }}
            {...(description === undefined ? { 'aria-describedby': undefined } : null)}
          >
            {closeButton === 'sticky' ? (
              <div className="sticky top-0 z-2 -mb-12 h-0">{close}</div>
            ) : null}
            <DialogPrimitive.Title className={closeButton === undefined ? TITLE : `${TITLE} pr-40`}>
              {title}
            </DialogPrimitive.Title>
            {closeButton === 'absolute' ? close : null}

            {description === undefined ? null : (
              <DialogPrimitive.Description className={DESCRIPTION}>
                {description}
              </DialogPrimitive.Description>
            )}

            {children}

            {actions === undefined ? null : <div className={ACTIONS}>{actions}</div>}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
