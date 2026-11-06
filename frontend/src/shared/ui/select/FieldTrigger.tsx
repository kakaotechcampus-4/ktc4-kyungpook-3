import type { ComponentPropsWithRef, ReactNode } from 'react'
import { Icon } from '../icon/Icon'
import { CHEVRON, CHEVRON_RIGHT, TRIGGER, TRIGGER_SIZE, triggerColor } from './selectStyles'

/** 닫힌 트리거에 보이는 고른 값 — 앞 아이콘과 글자. 보조줄은 보이지 않는다 */
export function TriggerValue({ label, leading }: { label: string; leading?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-10">
      {leading ? <span className="flex flex-none">{leading}</span> : null}
      <span className="truncate">{label}</span>
    </span>
  )
}

export function TriggerChevron({ size, disabled }: { size: 'md' | 'sm'; disabled: boolean }) {
  return (
    <span
      aria-hidden
      className={[CHEVRON, CHEVRON_RIGHT[size], disabled ? 'text-line-strong' : 'text-dim'].join(
        ' ',
      )}
    >
      <Icon name="chevron-down" size={14} />
    </span>
  )
}

interface FieldTriggerProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  shown: { label: string; leading?: ReactNode } | undefined
  placeholder: string | undefined
  size: 'md' | 'sm'
  tone: 'normal' | 'blocking'
  disabled: boolean
  /** 여는 목록(listbox)의 id */
  listId: string
  open: boolean
}

/**
 * 직접 만든 목록(시트·찾기 칸 목록)을 여는 트리거. Radix Select 트리거와 같은 모양·역할(combobox)이다.
 * Radix Dialog·Popover 의 Trigger 가 asChild 로 감싸 data-state·눌러 열기·포커스 복귀를 맡는다
 */
export function FieldTrigger({
  shown,
  placeholder,
  size,
  tone,
  disabled,
  listId,
  open,
  ...rest
}: FieldTriggerProps) {
  return (
    <button
      type="button"
      {...rest}
      role="combobox"
      aria-haspopup="listbox"
      aria-controls={listId}
      aria-expanded={open}
      disabled={disabled}
      data-placeholder={shown === undefined ? '' : undefined}
      className={[TRIGGER, TRIGGER_SIZE[size], triggerColor(tone, disabled)].join(' ')}
    >
      {shown ? <TriggerValue {...shown} /> : <span className="truncate">{placeholder}</span>}
      <TriggerChevron size={size} disabled={disabled} />
    </button>
  )
}
