import * as Dialog from '@radix-ui/react-dialog'
import { useRef, useState } from 'react'
import type { PointerEvent, ReactElement, ReactNode } from 'react'

/*
 * 휴대폰 폭에서 아래에서 올라오는 시트. Radix Dialog 위에 모양만 입힌다 — 포커스 가둠, Esc, 바깥 누르기 닫기,
 * 뒤 화면 스크롤 잠금, 닫을 때 트리거로 포커스 복귀는 Radix 가 한다. 아래로 끌어 닫기만 여기서 한다.
 * docs/plan/m6/basis-for-decision/2026-11-07-select-sheet-and-combobox.md
 */

/* 손잡이를 이보다 길게 끌어 내리면 닫는다. 줄 하나(52px)보다 길게 잡아, 손잡이를 짚다 조금 밀린 것은 닫지 않고 제자리로 돌린다 */
const CLOSE_DRAG_PX = 80

/* `inset-[0px]`·`bottom-[0px]` 은 tokens.css 에 `--spacing-0` 이 없어 `inset-0` 이 생성되지 않던 때의 우회다 (Modal 과 같다).
   #497 부터는 `inset-0` 도 같은 값이다 */
const SCRIM = 'fixed inset-[0px] z-100 bg-ink/32'
const PANEL =
  'fixed inset-x-[0px] bottom-[0px] z-100 flex max-h-[85dvh] flex-col rounded-t-[20px] bg-surface px-16 pb-[calc(30px+env(safe-area-inset-bottom))] text-ink outline-none'
/* 끄는 자리 — 손잡이와 제목. 목록은 스크롤해야 하므로 끌기를 받지 않는다 */
const GRIP = 'flex cursor-grab touch-none flex-col items-stretch pt-10 pb-6 select-none'
const HANDLE = 'mb-12 h-4 w-36 self-center rounded-999 bg-line'
const TITLE = 'text-[16px] font-bold'

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 시트를 연 칸의 이름. 대화상자의 이름이 된다 */
  title: string
  /** 여닫는 단추. 닫히면 포커스가 여기로 돌아온다. 없으면 화면이 `open` 으로 열고, 닫히면 열기 전 포커스로 돌아간다 */
  trigger?: ReactElement
  children: ReactNode
}

export function Sheet({ open, onOpenChange, title, trigger, children }: SheetProps) {
  const startY = useRef<number | null>(null)
  const [offset, setOffset] = useState(0)

  function release() {
    startY.current = null
    setOffset(0)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger === undefined ? null : <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className={SCRIM} />
        <Dialog.Content
          aria-describedby={undefined}
          className={PANEL}
          style={offset > 0 ? { transform: `translateY(${String(offset)}px)` } : undefined}
        >
          <div
            className={GRIP}
            onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
              if (event.button !== 0) return
              startY.current = event.clientY
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (startY.current !== null) setOffset(Math.max(0, event.clientY - startY.current))
            }}
            onPointerUp={(event) => {
              if (startY.current === null) return
              const dragged = event.clientY - startY.current
              release()
              if (dragged > CLOSE_DRAG_PX) onOpenChange(false)
            }}
            onPointerCancel={release}
          >
            <span aria-hidden className={HANDLE} />
            <Dialog.Title className={TITLE}>{title}</Dialog.Title>
          </div>
          <div className="flex min-h-[0px] flex-1 flex-col gap-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
