import * as RadixSelect from '@radix-ui/react-select'
import type { ReactNode } from 'react'
import { Icon } from '../icon/Icon'

/*
 * Radix Select 에 시각만 입힌다. 동작 — 화살표 이동, 비활성 건너뛰기, 글자 검색, Enter 고르기,
 * Esc 닫기, 닫을 때 트리거로 포커스 복귀 — 는 전부 Radix 가 한다.
 * 목록 모양은 DropdownMenu 와 같다 (반경 14 · 줄 반경 10 · 고른 줄 surface-selected · 그림자 없음).
 * docs/plan/m6/basis-for-decision/2026-11-07-shared-select-on-radix.md
 */

export interface SelectOption<V extends string> {
  value: V
  /** 트리거에 보이는 글자이자 글자 검색 대상 */
  label: string
  /** 글자 앞 아이콘 자리 — 이니셜 원, 상태 표식 */
  leading?: ReactNode
  /** 글자 아래 둘째 줄. 트리거에는 보이지 않는다 */
  description?: ReactNode
  disabled?: boolean
}

export interface SelectProps<V extends string> {
  value: V | null
  onValueChange: (value: V | null) => void
  options: readonly SelectOption<V>[]
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
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

/* Radix 는 '' 를 항목 값으로 받지 않는다 — '' 는 플레이스홀더를 보이라는 뜻이다.
   그래서 「값 없음」 줄은 이 값으로 두고, 바깥으로는 null 로만 낸다 */
const NONE = '__none__'

/* 15px · 14px · 11px 는 타이포 스케일 밖이다 — 시안 select-design.html 실측.
   docs/plan/m2/basis-for-decision/2026-09-16-values-outside-token-scale.md */

const TRIGGER = 'group relative flex w-full items-center rounded-9 border text-left'

const TRIGGER_SIZE = {
  md: 'min-h-44 pr-40 pl-13 text-[15px]',
  sm: 'min-h-36 pr-34 pl-12 text-[14px]',
} as const

const CHEVRON_RIGHT = { md: 'right-13', sm: 'right-11' } as const

/* 경계·글자·포커스 선 색은 한 곳에서만 고른다 — 두 클래스를 같이 붙이면 CSS 순서가 이긴다.
   막힌 칸의 포커스 선은 강조색이다 — 먹 선이 덮으면 포커스 중에 "승인이 막힌 칸"이라는 신호가 사라진다.
   보통 칸은 전역 먹 선을 그대로 쓴다. docs/plan/m2/basis-for-decision/2026-09-23-focus-outline-over-border.md */
function triggerColor(tone: 'normal' | 'blocking', disabled: boolean) {
  if (disabled) return 'cursor-not-allowed border-line bg-surface-sunken text-faint'
  if (tone === 'blocking')
    return 'cursor-pointer border-accent bg-surface text-ink data-[placeholder]:text-accent-solid focus-visible:outline-accent-point'
  return 'cursor-pointer border-input-border bg-surface text-ink data-[placeholder]:text-dim hover:not-data-[state=open]:border-sub data-[state=open]:border-ink'
}

const CONTENT =
  'z-100 max-w-[340px] min-w-[var(--radix-select-trigger-width)] rounded-[14px] border border-line bg-surface p-8 text-ink'

/* 스크롤 버튼 대신 스크롤바를 쓴다. Radix 가 뷰포트 스크롤바를 숨기는 style 을 넣어서 덮는다 */
const VIEWPORT = 'flex max-h-[264px] flex-col gap-1 [scrollbar-width:thin]!'

/* 줄은 격자다 — 보조줄이 앞 아이콘 아래가 아니라 글자 아래에 선다.
   Radix 2.3.7 의 ItemText·Value 는 className 을 버린다. 그래서 ItemText 에는 글자만 두고 격자 칸은 감싼 span 이 잡으며,
   트리거 내용은 Value 의 children 으로 따로 그린다 */
const ITEM =
  'grid min-h-40 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center rounded-10 px-10 py-9 text-[15px] outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:text-faint data-[highlighted]:bg-surface-selected data-[state=checked]:font-bold'

function Item({ value, label, leading, description, disabled }: SelectOption<string>) {
  return (
    <RadixSelect.Item value={value} textValue={label} disabled={disabled} className={ITEM}>
      {leading ? <span className="col-start-1 mr-10 flex flex-none">{leading}</span> : null}
      <span className="col-start-2 truncate">
        <RadixSelect.ItemText>{label}</RadixSelect.ItemText>
      </span>
      {description ? (
        <span className="col-start-2 row-start-2 text-caption font-normal text-dim">
          {description}
        </span>
      ) : null}
      <RadixSelect.ItemIndicator className="col-start-3 row-span-2 row-start-1 ml-10 flex">
        <Icon name="check" size={16} />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  )
}

/**
 * 값 하나를 고르는 선택 상자. 기본 `<select>` 대신 쓴다.
 *
 * 목록은 늘 트리거 아래로 연다(popper). Radix 기본인 item-aligned 는 쓰지 않는다.
 * 문구는 전부 props 다. 라벨은 호출부가 `<Label htmlFor={id}>` 나 `aria-labelledby` 로 잇는다.
 */
export function Select<V extends string>({
  value,
  onValueChange,
  options,
  noneOption,
  placeholder,
  size = 'md',
  tone = 'normal',
  disabled = false,
  id,
  name,
  ...aria
}: SelectProps<V>) {
  const rootValue = value ?? (placeholder === undefined && noneOption ? NONE : '')

  const shown =
    value === null
      ? placeholder === undefined
        ? noneOption
        : undefined
      : options.find((option) => option.value === value)

  function handleValueChange(next: string) {
    onValueChange(options.find((option) => option.value === next)?.value ?? null)
  }

  return (
    <RadixSelect.Root
      value={rootValue}
      onValueChange={handleValueChange}
      disabled={disabled}
      name={name}
    >
      <RadixSelect.Trigger
        id={id}
        className={[TRIGGER, TRIGGER_SIZE[size], triggerColor(tone, disabled)].join(' ')}
        {...aria}
      >
        <RadixSelect.Value placeholder={placeholder}>
          {shown ? (
            <span className="flex min-w-0 items-center gap-10">
              {shown.leading ? <span className="flex flex-none">{shown.leading}</span> : null}
              <span className="truncate">{shown.label}</span>
            </span>
          ) : undefined}
        </RadixSelect.Value>
        <RadixSelect.Icon
          className={[
            'absolute top-1/2 flex -translate-y-1/2 group-data-[state=open]:rotate-180',
            CHEVRON_RIGHT[size],
            disabled ? 'text-line-strong' : 'text-dim',
          ].join(' ')}
        >
          <Icon name="chevron-down" size={14} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          side="bottom"
          align="start"
          sideOffset={6}
          className={CONTENT}
        >
          <RadixSelect.Viewport className={VIEWPORT}>
            {noneOption ? (
              <Item value={NONE} label={noneOption.label} leading={noneOption.leading} />
            ) : null}
            {options.map((option) => (
              <Item key={option.value} {...option} />
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
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
