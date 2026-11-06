import * as RadixPopover from '@radix-ui/react-popover'
import { useId, useMemo, useState } from 'react'
import type { FocusEventHandler, KeyboardEvent, Ref } from 'react'
import { useNarrowViewport } from '@/shared/lib/narrow-viewport'
import { Icon } from '../icon/Icon'
import { Sheet } from '../sheet/Sheet'
import { FieldTrigger } from './FieldTrigger'
import { OptionList } from './OptionList'
import { filterOptions, initialActive, optionDomId, stepActive } from './options'
import type { SelectOption } from './options'
import { PANEL } from './selectStyles'

/*
 * 찾기 칸이 있는 선택 상자. Radix Select 는 목록 안에 입력을 둘 수 없어서 넓은 화면은 Radix Popover, 휴대폰 폭은 시트에
 * 찾기 칸과 같은 목록(OptionList)을 넣는다. 트리거·목록 모양은 Select 와 같은 클래스에서 나온다.
 * 찾기 칸이 포커스를 갖고(role=combobox), ↑↓ 로 짚은 줄은 aria-activedescendant 로 알린다. Esc·바깥 누르기·포커스 복귀는 Radix 가 한다.
 * docs/plan/m6/basis-for-decision/2026-11-07-select-sheet-and-combobox.md
 */

const SEARCH =
  'flex min-h-40 items-center gap-8 rounded-10 border border-line px-10 text-dim focus-within:border-ink'
/* 칸 테두리가 포커스를 보인다 — 입력 자체의 전역 포커스 선은 겹치지 않게 끈다 */
const SEARCH_INPUT =
  'min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-dim focus-visible:outline-none'
const EMPTY = 'px-10 py-14 text-[13.5px] text-dim'

export interface ComboboxProps<V extends string> {
  value: V | null
  onValueChange: (value: V) => void
  options: readonly SelectOption<V>[]
  /** 칸 이름. 목록의 이름이자 휴대폰 폭 시트의 제목이다 */
  label: string
  /** 찾기 칸의 이름과 빈 칸 안내 */
  searchLabel: string
  /** 찾는 글자에 맞는 줄이 없을 때 */
  emptyText: string
  placeholder?: string
  size?: 'md' | 'sm'
  tone?: 'normal' | 'blocking'
  disabled?: boolean
  id?: string
  ref?: Ref<HTMLButtonElement>
  onBlur?: FocusEventHandler<HTMLButtonElement>
  'aria-invalid'?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/**
 * 줄이 많아 찾아 골라야 하는 선택 상자. 몇 줄부터 이것을 쓸지는 호출부가 정한다.
 * 찾기는 줄 글자(label)에 칸의 글자가 들어 있는지로 거른다
 */
export function Combobox<V extends string>({
  value,
  onValueChange,
  options,
  label,
  searchLabel,
  emptyText,
  placeholder,
  size = 'md',
  tone = 'normal',
  disabled = false,
  id,
  ref,
  onBlur,
  'aria-invalid': invalid,
  ...aria
}: ComboboxProps<V>) {
  const narrow = useNarrowViewport()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<V | null>(null)
  const visible = useMemo(() => filterOptions(options, query), [options, query])
  const activeIndex = visible.findIndex((option) => option.value === active)

  function openChange(next: boolean) {
    if (next) {
      setQuery('')
      setActive(initialActive(options, value))
    }
    setOpen(next)
  }

  function choose(next: V) {
    setOpen(false)
    onValueChange(next)
  }

  function handleSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = stepActive(visible, active, event.key)
      if (next !== null) setActive(next)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = visible[activeIndex]
      if (option !== undefined && !option.disabled) choose(option.value)
    }
  }

  const trigger = (
    <FieldTrigger
      ref={ref}
      id={id}
      listId={listId}
      open={open}
      shown={options.find((option) => option.value === value)}
      placeholder={placeholder}
      size={size}
      tone={tone}
      disabled={disabled}
      onBlur={onBlur}
      aria-invalid={invalid || undefined}
      {...aria}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        openChange(true)
      }}
    />
  )

  const body = (
    <>
      <label className={SEARCH}>
        <Icon name="search" size={14} />
        <input
          type="text"
          role="combobox"
          aria-label={searchLabel}
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex === -1 ? undefined : optionDomId(listId, activeIndex)}
          placeholder={searchLabel}
          autoComplete="off"
          className={SEARCH_INPUT}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(initialActive(filterOptions(options, event.target.value), null))
          }}
          onKeyDown={handleSearchKey}
        />
      </label>
      {visible.length === 0 ? (
        <p role="status" className={EMPTY}>
          {emptyText}
        </p>
      ) : null}
      <OptionList
        id={listId}
        options={visible}
        selected={value}
        active={active}
        onActiveChange={setActive}
        onSelect={choose}
        rowSize={narrow ? 'sheet' : 'menu'}
        aria-label={label}
      />
    </>
  )

  if (narrow)
    return (
      <Sheet open={open} onOpenChange={openChange} title={label} trigger={trigger}>
        {body}
      </Sheet>
    )

  return (
    <RadixPopover.Root open={open} onOpenChange={openChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          aria-label={label}
          className={`${PANEL} flex min-w-[var(--radix-popover-trigger-width)] flex-col gap-6`}
        >
          {body}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}
