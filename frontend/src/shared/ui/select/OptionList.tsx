import { useEffect, useRef } from 'react'
import type { KeyboardEvent } from 'react'
import { Icon } from '../icon/Icon'
import { isStepKey, matchTyped, optionDomId, stepActive } from './options'
import type { SelectOption } from './options'
import {
  ITEM,
  ITEM_CHECK,
  ITEM_DESCRIPTION,
  ITEM_LABEL,
  ITEM_LEADING,
  ITEM_SIZE,
  LIST,
  LIST_SIZE,
  centerInList,
} from './selectStyles'

/* Radix Select 와 같은 글자 찾기 간격 — 1초 안에 친 글자는 이어 붙여 찾는다 */
const TYPEAHEAD_MS = 1000

export interface OptionListProps<V extends string> {
  id: string
  options: readonly SelectOption<V>[]
  /** 고른 값. 굵게 + 체크, aria-selected */
  selected: V | null
  /** 키보드로 짚은 줄. 포커스는 옮기지 않고 aria-activedescendant 로 알린다 */
  active: V | null
  onActiveChange: (value: V) => void
  onSelect: (value: V) => void
  rowSize: 'menu' | 'sheet'
  /**
   * 목록이 포커스와 키를 직접 받는다(시트 안의 Select) — ↑↓ Home End, Enter·Space 고르기, 글자 찾기.
   * 찾기 칸이 있으면 칸이 포커스를 갖고 aria-activedescendant 와 키를 대신 맡는다
   */
  focusable?: boolean
  'aria-label': string
}

/**
 * 값 하나를 고르는 목록(listbox). 시트 안의 Select 와 Combobox 가 함께 쓴다.
 * 넓은 화면의 Select 는 Radix 목록을 쓰지만 줄 모양 클래스는 같은 곳(selectStyles)에서 나온다
 */
export function OptionList<V extends string>({
  id,
  options,
  selected,
  active,
  onActiveChange,
  onSelect,
  rowSize,
  focusable = false,
  'aria-label': ariaLabel,
}: OptionListProps<V>) {
  const listRef = useRef<HTMLUListElement>(null)
  const typed = useRef({ text: '', at: -Infinity })
  const activeIndex = options.findIndex((option) => option.value === active)
  const activeId = activeIndex === -1 ? undefined : optionDomId(id, activeIndex)

  useEffect(() => {
    const list = listRef.current
    const chosen = list?.querySelector('[aria-selected="true"]')
    if (list && chosen instanceof HTMLElement) centerInList(list, chosen)
  }, [])

  useEffect(() => {
    const list = listRef.current
    const item = activeId === undefined ? null : document.getElementById(activeId)
    if (!list || !item) return
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight
  }, [activeId])

  function handleKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (isStepKey(event.key)) {
      event.preventDefault()
      const next = stepActive(options, active, event.key)
      if (next !== null) onActiveChange(next)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = options[activeIndex]
      if (option !== undefined && !option.disabled) onSelect(option.value)
      return
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return
    const memo = typed.current
    memo.text = event.timeStamp - memo.at < TYPEAHEAD_MS ? memo.text + event.key : event.key
    memo.at = event.timeStamp
    const match = matchTyped(options, active, memo.text)
    if (match !== null) onActiveChange(match)
  }

  return (
    <ul
      ref={listRef}
      id={id}
      role="listbox"
      aria-label={ariaLabel}
      tabIndex={focusable ? 0 : undefined}
      aria-activedescendant={focusable ? activeId : undefined}
      onKeyDown={focusable ? handleKeyDown : undefined}
      className={`${LIST} ${LIST_SIZE[rowSize]}`}
    >
      {options.map(({ value, label, leading, description, disabled }, index) => {
        const checked = value === selected
        return (
          <li
            key={value}
            id={optionDomId(id, index)}
            role="option"
            aria-selected={checked}
            aria-disabled={disabled || undefined}
            data-state={checked ? 'checked' : 'unchecked'}
            data-highlighted={index === activeIndex ? '' : undefined}
            data-disabled={disabled ? '' : undefined}
            className={`${ITEM} ${ITEM_SIZE[rowSize]}`}
            // 줄을 눌러도 포커스는 목록이나 찾기 칸에 남는다
            onMouseDown={(event) => event.preventDefault()}
            onPointerMove={() => {
              if (!disabled && index !== activeIndex) onActiveChange(value)
            }}
            // 키는 줄이 아니라 목록이나 찾기 칸이 받고, 짚은 줄은 aria-activedescendant 로 알린다
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            onClick={() => {
              if (!disabled) onSelect(value)
            }}
          >
            {leading ? <span className={ITEM_LEADING}>{leading}</span> : null}
            <span className={ITEM_LABEL}>{label}</span>
            {description ? <span className={ITEM_DESCRIPTION}>{description}</span> : null}
            {checked ? (
              <span className={ITEM_CHECK}>
                <Icon name="check" size={16} />
              </span>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
