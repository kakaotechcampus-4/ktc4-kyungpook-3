import * as RadixPopover from '@radix-ui/react-popover'
import { useId, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { TextField } from '../text-field/TextField'
import type { TextFieldProps } from '../text-field/TextField'
import { OptionList } from './OptionList'
import { filterOptions, optionDomId, stepActive } from './options'
import type { SelectOption } from './options'
import { PANEL } from './selectStyles'

/*
 * 자유 입력 칸에 제안 목록을 붙인다. Combobox 는 고른 값만 받지만 이것은 아무 글자나 받고, 제안은 고르기 쉽게 거들 뿐이다.
 * 포커스는 늘 입력 칸에 있다 — 목록은 Popover 를 칸에 Anchor 로 붙여 띄우고, 짚은 줄은 aria-activedescendant 로 알린다.
 * 휴대폰 폭에서도 시트가 아니라 같은 팝오버다 — 시트는 입력 중 화면 키보드와 겹친다.
 * Esc 는 Radix 가 가장 위 층만 닫는다 — 창(Modal) 안에서 목록이 열려 있으면 목록만 닫힌다
 */

export interface AutocompleteProps extends Omit<
  TextFieldProps,
  'value' | 'onChange' | 'defaultValue' | 'list'
> {
  value: string
  onValueChange: (value: string) => void
  /** 제안할 글자. 칸 글자가 들어 있는 줄만 보인다 */
  suggestions: readonly string[]
  /** 제안 목록(listbox)의 이름 */
  listLabel: string
}

export function Autocomplete({
  value,
  onValueChange,
  suggestions,
  listLabel,
  id,
  onBlur,
  onKeyDown,
  ...field
}: AutocompleteProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const options = useMemo<SelectOption<string>[]>(
    () => [...new Set(suggestions)].map((suggestion) => ({ value: suggestion, label: suggestion })),
    [suggestions],
  )
  const visible = useMemo(() => filterOptions(options, value), [options, value])
  const settled = visible.length === 1 && visible[0].value === value
  const shown = open && visible.length > 0 && !settled
  const activeIndex = shown ? visible.findIndex((option) => option.value === active) : -1

  function choose(next: string) {
    setOpen(false)
    setActive(null)
    onValueChange(next)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(event)
    // 한글 조합을 확정하는 Enter·조합 중 화살표는 입력기 몫이다. Safari 는 확정 Enter 를 keyCode 229 로만 보낸다
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!shown && event.key === 'ArrowUp') return
      event.preventDefault()
      setOpen(true)
      setActive(stepActive(visible, shown ? active : null, event.key))
    } else if (event.key === 'Enter' && activeIndex !== -1) {
      // 짚은 줄이 없으면 막지 않는다 — Enter 는 폼 제출이다
      event.preventDefault()
      choose(visible[activeIndex].value)
    }
  }

  return (
    <RadixPopover.Root
      open={shown}
      onOpenChange={(next) => {
        if (!next) setOpen(false)
      }}
    >
      <RadixPopover.Anchor asChild>
        <TextField
          {...field}
          id={inputId}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={shown ? listId : undefined}
          aria-activedescendant={activeIndex === -1 ? undefined : optionDomId(listId, activeIndex)}
          autoComplete="off"
          value={value}
          onChange={(event) => {
            onValueChange(event.target.value)
            setOpen(true)
            setActive(null)
          }}
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            setOpen(false)
            onBlur?.(event)
          }}
        />
      </RadixPopover.Anchor>
      <RadixPopover.Portal>
        <RadixPopover.Content
          // 목록은 포커스를 받지 않는다 — Radix 기본 role(dialog)은 맞지 않는다
          role="presentation"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            // 칸을 누르는 것은 바깥이 아니다 — 칸은 Anchor 라 Radix 가 트리거로 보지 않는다
            if (
              event.target instanceof Node &&
              document.getElementById(inputId)?.contains(event.target)
            )
              event.preventDefault()
          }}
          className={`${PANEL} w-[var(--radix-popover-trigger-width)]`}
        >
          <OptionList
            id={listId}
            options={visible}
            selected={null}
            active={activeIndex === -1 ? null : active}
            onActiveChange={setActive}
            onSelect={choose}
            rowSize="menu"
            aria-label={listLabel}
          />
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}
