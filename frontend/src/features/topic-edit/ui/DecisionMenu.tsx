import { useRef } from 'react'
import type { TopicDecision } from '@/entities/project-map'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Icon } from '@/shared/ui/icon'

const TRIGGER =
  'inline-flex h-28 w-28 shrink-0 items-center justify-center rounded-7 text-sub hover:bg-control'

export interface DecisionMenuProps {
  decision: TopicDecision
  /**
   * 다른 고치기를 저장하는 중이다. 항목만 막는다 — 유효하지 않음 표시를 고른 뒤 포커스가 트리거에 있어
   * 트리거를 막으면 포커스가 빠진다
   */
  pending: boolean
  /** 문장 고치기를 닫은 뒤 이 단추로 돌아온다 */
  triggerRef: (node: HTMLButtonElement | null) => void
  onEditText: () => void
  /** 유효하지 않음 표시와 되돌리기. 되돌릴 수 있어 묻지 않는다 */
  onToggleValid: () => void
  onRemove: () => void
}

/** 결정 한 줄의 고치기 메뉴 */
export function DecisionMenu({
  decision,
  pending,
  triggerRef,
  onEditText,
  onToggleValid,
  onRemove,
}: DecisionMenuProps) {
  const trigger = useRef<HTMLButtonElement | null>(null)
  // 폼·확인 창은 메뉴가 닫혀 트리거로 포커스가 돌아온 뒤 연다 — 확인 창이 트리거를 연 요소로 기억해 닫을 때 돌려준다
  const after = useRef<(() => void) | null>(null)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={(node) => {
          trigger.current = node
          triggerRef(node)
        }}
        className={TRIGGER}
        aria-label={`결정 고치기: ${decision.text}`}
      >
        <Icon name="edit" size={15} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[220px]"
        onCloseAutoFocus={(event) => {
          const open = after.current
          after.current = null
          if (open === null) return
          event.preventDefault()
          trigger.current?.focus()
          open()
        }}
      >
        <DropdownMenuItem disabled={pending} onSelect={() => (after.current = onEditText)}>
          문장 고치기
        </DropdownMenuItem>
        <DropdownMenuItem disabled={pending} onSelect={onToggleValid}>
          {decision.state === 'invalid' ? '유효로 되돌리기' : '유효하지 않음으로 표시'}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={pending} onSelect={() => (after.current = onRemove)}>
          지우기
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
