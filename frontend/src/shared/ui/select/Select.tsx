import * as RadixSelect from '@radix-ui/react-select'
import { useId, useRef, useState } from 'react'
import type { FocusEventHandler, ReactNode, Ref } from 'react'
import { useNarrowViewport } from '@/shared/lib/narrow-viewport'
import { Icon } from '../icon/Icon'
import { Sheet } from '../sheet/Sheet'
import { FieldTrigger, TriggerChevron, TriggerValue } from './FieldTrigger'
import { OptionList } from './OptionList'
import { initialActive } from './options'
import type { SelectOption } from './options'
import {
  ITEM,
  ITEM_CHECK,
  ITEM_DESCRIPTION,
  ITEM_LABEL,
  ITEM_LEADING,
  ITEM_SIZE,
  LIST,
  PANEL,
  TRIGGER,
  TRIGGER_SIZE,
  centerInList,
  triggerColor,
} from './selectStyles'

/*
 * 넓은 화면은 Radix Select 에 시각만 입힌다. 동작 — 화살표 이동, 비활성 건너뛰기, 글자 검색, Enter 고르기,
 * Esc 닫기, 닫을 때 트리거로 포커스 복귀 — 는 전부 Radix 가 한다.
 * 휴대폰 폭(560px 미만)은 같은 모양의 트리거로 아래 시트를 열고, 시트 안 목록(OptionList)이 같은 키보드 규칙을 따른다.
 * 목록 모양은 DropdownMenu 와 같다 (반경 14 · 줄 반경 10 · 고른 줄 surface-selected · 그림자 없음).
 * docs/plan/m6/basis-for-decision/2026-11-07-shared-select-on-radix.md
 */

export interface SelectProps<V extends string> {
  value: V | null
  onValueChange: (value: V | null) => void
  options: readonly SelectOption<V>[]
  /** 칸 이름. 휴대폰 폭 시트의 제목이다 — 트리거의 라벨은 따로 `<Label htmlFor>`·`aria-label` 로 잇는다 */
  label: string
  /** 맨 위 「값 없음」 줄. 고르면 onValueChange(null) */
  noneOption?: { label: string; leading?: ReactNode }
  /** value 가 null 일 때 보이는 글자. 없으면 noneOption 줄이 고른 값으로 보인다 */
  placeholder?: string
  /** 트리거 높이 44 / 36. 기본 'md' */
  size?: 'md' | 'sm'
  /** 'blocking' 은 비우면 승인이 막히는 칸이다 — 레드 R2 */
  tone?: 'normal' | 'blocking'
  disabled?: boolean
  id?: string
  name?: string
  /** 트리거 버튼으로 간다 — React Hook Form 의 Controller 가 오류 칸 포커스에 쓴다. React 19 라 일반 prop 이다 */
  ref?: Ref<HTMLButtonElement>
  /** 트리거를 떠날 때. 목록을 열어 포커스가 목록으로 갈 때도 부른다 */
  onBlur?: FocusEventHandler<HTMLButtonElement>
  /** 지금 값으로는 승인할 수 없다. 미정(null)은 오류가 아니다 — 호출부가 정한다 */
  'aria-invalid'?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/* Radix 는 '' 를 항목 값으로 받지 않는다 — '' 는 플레이스홀더를 보이라는 뜻이다.
   그래서 「값 없음」 줄은 이 값으로 두고, 바깥으로는 null 로만 낸다 */
const NONE = '__none__'

/**
 * 값 하나를 고르는 선택 상자. 기본 `<select>` 대신 쓴다.
 *
 * 넓은 화면의 목록은 늘 트리거 아래로 연다(popper). Radix 기본인 item-aligned 는 쓰지 않는다.
 * 열면 고른 줄이 목록 가운데에 온다 — 시각처럼 긴 목록에서 고른 값 앞뒤가 함께 보인다. 문구는 전부 props 다.
 */
export function Select<V extends string>(props: SelectProps<V>) {
  return useNarrowViewport() ? <SheetSelect {...props} /> : <PopperSelect {...props} />
}

/** 목록에 놓는 줄 — 「값 없음」 줄이 맨 위다 */
function listOptions<V extends string>({
  options,
  noneOption,
}: SelectProps<V>): readonly SelectOption<string>[] {
  return noneOption ? [{ value: NONE, ...noneOption }, ...options] : options
}

/** 목록에서 고른 줄. 값이 null 이고 플레이스홀더가 없으면 「값 없음」 줄이다 */
function chosenValue<V extends string>({ value, noneOption, placeholder }: SelectProps<V>) {
  return value ?? (placeholder === undefined && noneOption ? NONE : null)
}

/** 목록 줄의 값을 바깥 값으로. 「값 없음」 줄은 null 이다 */
function fromList<V extends string>(options: readonly SelectOption<V>[], next: string): V | null {
  return options.find((option) => option.value === next)?.value ?? null
}

/* Radix 2.3.7 의 ItemText·Value 는 className 을 버린다. 그래서 ItemText 에는 글자만 두고 격자 칸은 감싼 span 이 잡으며,
   트리거 내용은 Value 의 children 으로 따로 그린다 */
function Item({ value, label, leading, description, disabled }: SelectOption<string>) {
  return (
    <RadixSelect.Item
      value={value}
      textValue={label}
      disabled={disabled}
      className={`${ITEM} ${ITEM_SIZE.menu}`}
    >
      {leading ? <span className={ITEM_LEADING}>{leading}</span> : null}
      <span className={ITEM_LABEL}>
        <RadixSelect.ItemText>{label}</RadixSelect.ItemText>
      </span>
      {description ? <span className={ITEM_DESCRIPTION}>{description}</span> : null}
      <RadixSelect.ItemIndicator className={ITEM_CHECK}>
        <Icon name="check" size={16} />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  )
}

function PopperSelect<V extends string>(props: SelectProps<V>) {
  const {
    onValueChange,
    options,
    placeholder,
    size = 'md',
    tone = 'normal',
    disabled = false,
    id,
    name,
    ref,
    onBlur,
    'aria-invalid': invalid,
    'aria-label': ariaLabel,
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
  } = props
  const items = listOptions(props)
  const chosen = chosenValue(props)
  const shown = items.find((option) => option.value === chosen)
  // 열 때 Radix 가 고른 줄에 처음 포커스를 줄 때만 가운데로 굴린다. 화살표로 옮길 때는 Radix 의 「가까이」 스크롤을 둔다
  const centered = useRef(false)

  return (
    <RadixSelect.Root
      value={chosen ?? ''}
      onValueChange={(next) => onValueChange(fromList(options, next))}
      onOpenChange={(open) => {
        if (open) centered.current = false
      }}
      disabled={disabled}
      name={name}
    >
      <RadixSelect.Trigger
        ref={ref}
        id={id}
        onBlur={onBlur}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className={[TRIGGER, TRIGGER_SIZE[size], triggerColor(tone, disabled)].join(' ')}
      >
        <RadixSelect.Value placeholder={placeholder}>
          {shown ? <TriggerValue {...shown} /> : undefined}
        </RadixSelect.Value>
        <TriggerChevron size={size} disabled={disabled} />
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          side="bottom"
          align="start"
          sideOffset={6}
          className={`${PANEL} min-w-[var(--radix-select-trigger-width)]`}
          onFocus={(event) => {
            const viewport = event.target.parentElement
            if (
              centered.current ||
              viewport === null ||
              event.target.getAttribute('role') !== 'option'
            )
              return
            centered.current = true
            centerInList(viewport, event.target)
          }}
        >
          <RadixSelect.Viewport className={`${LIST} max-h-[264px]`}>
            {items.map((option) => (
              <Item key={option.value} {...option} />
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}

function SheetSelect<V extends string>(props: SelectProps<V>) {
  const {
    onValueChange,
    options,
    label,
    placeholder,
    size = 'md',
    tone = 'normal',
    disabled = false,
    id,
    ref,
    onBlur,
    'aria-invalid': invalid,
    'aria-label': ariaLabel,
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
  } = props
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string | null>(null)
  const items = listOptions(props)
  const chosen = chosenValue(props)

  function openChange(next: boolean) {
    if (next) setActive(initialActive(items, chosen))
    setOpen(next)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={openChange}
      title={label}
      trigger={
        <FieldTrigger
          ref={ref}
          id={id}
          listId={listId}
          open={open}
          shown={items.find((option) => option.value === chosen)}
          placeholder={placeholder}
          size={size}
          tone={tone}
          disabled={disabled}
          onBlur={onBlur}
          aria-invalid={invalid || undefined}
          aria-label={ariaLabel}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            event.preventDefault()
            openChange(true)
          }}
        />
      }
    >
      <OptionList
        id={listId}
        options={items}
        selected={chosen}
        active={active}
        onActiveChange={setActive}
        onSelect={(next) => {
          setOpen(false)
          onValueChange(fromList(options, next))
        }}
        rowSize="sheet"
        focusable
        aria-label={label}
      />
    </Sheet>
  )
}

const MARK = 'inline-grid size-24 flex-none place-items-center rounded-999 text-[11px] font-bold'

/** 팀원 이니셜 원. 이름 첫 글자 */
export function SelectInitial({ name }: { name: string }) {
  return (
    <span aria-hidden className={`${MARK} bg-control`}>
      {Array.from(name)[0]}
    </span>
  )
}

/** 「미정」 줄의 점선 원 */
export function SelectNoneMark() {
  return (
    <span
      aria-hidden
      className={`${MARK} border border-dashed border-input-border bg-surface text-dim`}
    >
      ?
    </span>
  )
}
