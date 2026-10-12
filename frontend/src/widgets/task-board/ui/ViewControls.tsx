import type { ReactNode } from 'react'
import type { Member } from '@/entities/member'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Icon } from '@/shared/ui/icon'
import { Segmented, SegmentedItem } from '@/shared/ui/segmented'
import type { DueCondition } from '../lib/taskBoard'
import { TASK_VIEWS } from '../lib/taskViews'
import type { BoardPeriod, TaskView } from '../lib/taskViews'

const VIEW_LABEL: Record<TaskView, string> = {
  list: '리스트',
  board: '보드',
  calendar: '캘린더',
  gantt: '간트',
}

/** 화면 오른쪽 위 보기 전환 — 리스트·보드·캘린더·간트 */
export function ViewSwitch({
  value,
  onChange,
}: {
  value: TaskView
  onChange: (view: TaskView) => void
}) {
  return (
    <Segmented
      value={value}
      aria-label="보기 방식"
      onValueChange={(next) => {
        const view = TASK_VIEWS.find((each) => each === next)
        if (view !== undefined) onChange(view)
      }}
    >
      {TASK_VIEWS.map((view) => (
        <SegmentedItem key={view} value={view}>
          {VIEW_LABEL[view]}
        </SegmentedItem>
      ))}
    </Segmented>
  )
}

/* 리스트 시안은 테두리가 투명이고(`1px solid transparent`), 보드 시안만 `#E8E8E8` 테두리가 있다 */
const TRIGGER =
  'inline-flex h-32 items-center gap-7 rounded-9 border bg-surface px-12 text-caption font-semibold text-ink hover:bg-surface-sunken'
const TRIGGER_BORDER = { none: 'border-transparent', line: 'border-line' } as const

interface FilterSelectProps {
  /** 닫혀 있을 때 보이는 현재 값 */
  label: string
  ariaLabel: string
  /** 보드처럼 테두리가 보이는 곳이다. 기본은 투명 테두리 */
  bordered?: boolean
  children: ReactNode
}

/** 시안의 콤보박스 — `담당자 전체 ⌄`. 항목은 자식이 준다 */
function FilterSelect({ label, ariaLabel, bordered = false, children }: FilterSelectProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${ariaLabel}: ${label}`}
          className={`${TRIGGER} ${TRIGGER_BORDER[bordered ? 'line' : 'none']}`}
        >
          {label}
          <Icon name="chevron-down" size={14} className="text-dim" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        // 기본 292px 대신 내용 폭 — 작아도 버튼 폭보다 좁아지지 않는다
        style={{ width: 'auto', minWidth: 'var(--radix-dropdown-menu-trigger-width)' }}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Option({
  selected,
  role = 'menuitemradio',
  onSelect,
  children,
}: {
  selected: boolean
  role?: 'menuitemradio' | 'menuitemcheckbox'
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <DropdownMenuItem
      role={role}
      aria-checked={selected}
      className="justify-between gap-16 text-caption"
      onSelect={(event) => {
        // 여러 개를 고르는 메뉴는 열어 둔다
        if (role === 'menuitemcheckbox') event.preventDefault()
        onSelect()
      }}
    >
      <span className="flex-1">{children}</span>
      {/* 체크는 오른쪽 끝에만 둔다 — 왼쪽에 빈 칸을 남기지 않아 좌우 여백이 같다 */}
      {selected ? <Icon name="check" size={14} /> : null}
    </DropdownMenuItem>
  )
}

export function AssigneeFilter({
  members,
  value,
  bordered = false,
  onChange,
}: {
  bordered?: boolean
  members: readonly Member[]
  value: string | null
  onChange: (memberId: string | null) => void
}) {
  const selected = members.find(({ id }) => id === value)
  return (
    <FilterSelect
      label={selected?.displayName ?? '담당자 전체'}
      ariaLabel="담당자"
      bordered={bordered}
    >
      <Option selected={value === null} onSelect={() => onChange(null)}>
        담당자 전체
      </Option>
      {members.map(({ id, displayName }) => (
        <Option key={id} selected={value === id} onSelect={() => onChange(id)}>
          {displayName}
        </Option>
      ))}
    </FilterSelect>
  )
}

const DUE_OPTIONS = [
  ['overdue', '기한 지남'],
  ['soon', '7일 안에 마감'],
] as const satisfies readonly (readonly [DueCondition, string])[]

/** 마감 조건 — 둘 다 고를 수 있다. 고른 조건이 없으면 `마감 전체` 다 */
export function DueFilter({
  value,
  today,
  last,
  onChange,
}: {
  value: readonly DueCondition[]
  today: string
  /** `soon` 의 마지막 날 */
  last: string
  onChange: (due: DueCondition[]) => void
}) {
  const label =
    value.length === 0
      ? '마감 전체'
      : DUE_OPTIONS.filter(([condition]) => value.includes(condition))
          .map(([, text]) => text)
          .join(' · ')
  const toggle = (condition: DueCondition) =>
    onChange(
      value.includes(condition)
        ? value.filter((each) => each !== condition)
        : [...value, condition],
    )
  return (
    <FilterSelect label={label} ariaLabel="마감 조건">
      <Option selected={value.length === 0} onSelect={() => onChange([])}>
        마감 전체
      </Option>
      {DUE_OPTIONS.map(([condition, text]) => (
        <Option
          key={condition}
          role="menuitemcheckbox"
          selected={value.includes(condition)}
          onSelect={() => toggle(condition)}
        >
          <span title={condition === 'soon' ? `${today} ~ ${last}` : undefined}>{text}</span>
        </Option>
      ))}
    </FilterSelect>
  )
}

const PERIOD_LABEL: Record<BoardPeriod, string> = { all: '전체 기간', month: '이번 달' }

export function PeriodFilter({
  value,
  onChange,
}: {
  value: BoardPeriod
  onChange: (period: BoardPeriod) => void
}) {
  return (
    <FilterSelect label={PERIOD_LABEL[value]} ariaLabel="기간" bordered>
      {(['all', 'month'] as const).map((period) => (
        <Option key={period} selected={value === period} onSelect={() => onChange(period)}>
          {PERIOD_LABEL[period]}
        </Option>
      ))}
    </FilterSelect>
  )
}
