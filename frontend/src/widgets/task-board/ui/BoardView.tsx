import { memo, useId, useLayoutEffect, useRef } from 'react'
import type { KeyboardEvent, RefObject } from 'react'
import { TaskStatusMark } from '@/entities/task'
import type { Task, TaskStatus } from '@/entities/task'
import { AutoBlockNotice, useTaskAutoBlock } from '@/features/task-auto-block'
import { TaskQuickAdd } from '@/features/task-create'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { tabKeyTarget } from '../lib/tabKeys'
import { doneColumnNote, sortDoneColumn, sortLabel, sortTasks } from '../lib/taskSort'
import type { TaskSort } from '../lib/taskSort'
import {
  BOARD_COLUMNS,
  assigneeLabel,
  assigneeOf,
  cardBadges,
  columnSummary,
  countBadges,
  monthOf,
  shortDate,
  taskTone,
} from '../lib/taskViews'
import type { BoardColumnKey as Column, BoardPeriod, TaskTone } from '../lib/taskViews'
import { Avatar } from './viewParts'

/** 칸마다 담는 상태와, `직접 추가` 로 만든 태스크의 상태. 칸과 그 순서는 `BOARD_COLUMNS` 가 정한다 */
const COLUMN_SPEC: Record<
  Column,
  { title: string; statuses: readonly TaskStatus[]; createAs: TaskStatus }
> = {
  todo: { title: '시작 전', statuses: ['todo'], createAs: 'todo' },
  active: { title: '진행 중', statuses: ['in_progress', 'blocked'], createAs: 'in_progress' },
  done: { title: '완료', statuses: ['done'], createAs: 'done' },
}
const COLUMNS = BOARD_COLUMNS.map((key) => ({ key, ...COLUMN_SPEC[key] }))

/* 넓은 화면은 세 칸을 나란히 두고, 휴대폰은 칸 고르기 아래에 고른 칸 하나를 쌓는다(사이 10px) */
const COLUMNS_LAYOUT =
  'grid grid-cols-3 items-start gap-18 max-md:flex max-md:flex-col max-md:items-stretch max-md:gap-10'
/* 휴대폰 패널은 요약 줄·카드·직접 추가 사이가 12px 이다 */
const COLUMN_SECTION = 'flex flex-col gap-10 max-md:gap-12'

/* 칸 고르기 (PwaTasks 시안) — #EDEDED 트랙·둥글기 12·패딩 4 에 같은 폭 세 탭, 고른 탭은 흰 면·굵은 글자·둥글기 9 */
const PICKER = 'grid grid-cols-3 gap-2 rounded-12 bg-control p-4'
const PICKER_TAB =
  'inline-flex min-h-40 items-center justify-center gap-4 rounded-9 text-[14px] text-sub aria-selected:bg-surface aria-selected:font-bold aria-selected:text-ink'

/* 휴대폰 카드는 PwaTasks 시안 크기다 — 패딩 14/16·둥글기 14, 제목 15px, 아래 줄 13px, 배지 11.5px */
const CARD_BASE =
  'flex flex-col gap-12 rounded-12 border px-13 py-12 max-md:gap-10 max-md:rounded-[14px] max-md:px-16 max-md:py-14'
const PILL =
  'inline-flex h-20 shrink-0 items-center rounded-6 px-7 text-[10.5px] leading-none max-md:text-[11.5px]'
/* 막힘은 누르는 배지라 채운 `위험` 과 달리 테두리만 accent 로 그린다. 시안이 없어 위험 배지의 색·크기를 따른다 */
const BLOCKED_PILL = `${PILL} cursor-pointer border border-accent bg-surface font-bold text-accent hover:bg-accent-solid hover:text-surface data-[state=open]:bg-accent-solid data-[state=open]:text-surface`

export interface BoardViewProps {
  workspaceId: string
  tasks: readonly Task[]
  names: ReadonlyMap<string, string>
  today: string
  period: BoardPeriod
  /** 칸 안의 순서. 완료 칸은 정렬마다 따로 정한 순서다 */
  sort: TaskSort
  /** 확인 필요 승인 수. PM 이 아니면 0 이다 */
  pendingApprovals: number
  /** 칸마다 `직접 추가` 를 둔다. 태스크 생성은 서버에서 PM 전용이다 */
  canCreate: boolean
  /** 담당자 조건. 걸러 보는 중이면 직접 추가한 태스크의 담당자로 넣는다 */
  assignee: string | null
  /** 폭 768px 미만이다. 세 칸을 나란히 두지 않고 고른 칸 하나만 보인다 */
  compact: boolean
  /** 휴대폰에서 고른 칸. 페이지가 URL 에 둔다 */
  column: Column
  /** 칸을 고른다. 폭이 줄어 포커스가 든 칸을 따라 고를 때는 `replace` 다 — 사용자가 고른 기록이 아니다 */
  onColumnChange: (column: Column, options?: { replace?: boolean }) => void
}

/**
 * 보드 (TasksBoard 시안). 승인이 끝난 태스크만 상태 세 칸으로 나뉜다. 휴대폰은 칸을 골라 한 칸씩 본다 (PwaTasks 시안).
 * 두 배치는 같은 칸 셋을 같은 자리에 그린다 — 휴대폰은 위에 칸 고르기를 더하고 고르지 않은 칸을 숨길 뿐이다.
 * 그래서 칸을 바꾸거나 768px 경계를 넘어도 칸마다 쓰던 `직접 추가` 와 그 포커스가 그 칸에 남는다
 */
export function BoardView({
  workspaceId,
  tasks,
  names,
  today,
  period,
  sort,
  pendingApprovals,
  canCreate,
  assignee,
  compact,
  column: selected,
  onColumnChange,
}: BoardViewProps) {
  const prefix = useId()
  const sections = useRef(new Map<Column, HTMLElement>())
  const pickerFocus = useRef<Column | null>(null)
  const refocus = useRef<{ column: Column; element: HTMLElement } | null>(null)
  const wasCompact = useRef(compact)

  // 경계를 넘으면 포커스를 보이는 자리에 둔다. 칸 고르기의 탭이 사라지면 그 칸으로 옮기고, 숨을 칸 안에 있으면 그 칸을 고른다
  useLayoutEffect(() => {
    if (wasCompact.current === compact) return
    wasCompact.current = compact
    if (!compact) {
      const left = pickerFocus.current
      pickerFocus.current = null
      if (left !== null) focusSection(sections.current.get(left))
      return
    }
    const active = document.activeElement
    for (const [key, section] of sections.current)
      if (key !== selected && active instanceof HTMLElement && section.contains(active)) {
        refocus.current = { column: key, element: active }
        onColumnChange(key, { replace: true })
      }
  }, [compact, selected, onColumnChange])

  // URL 이동은 transition 이라 고른 칸이 그려지기 전 한 번은 그 칸이 숨는다. 브라우저가 그때 놓친 포커스를 되돌린다
  useLayoutEffect(() => {
    const pending = refocus.current
    if (pending === null || pending.column !== selected) return
    refocus.current = null
    if (document.activeElement === null || document.activeElement === document.body)
      pending.element.focus()
  }, [selected])

  const scoped =
    period === 'month'
      ? tasks.filter((task) => task.dueDate === null || monthOf(task.dueDate) === monthOf(today))
      : tasks
  const columns = COLUMNS.map((column): BoardColumn => {
    const inColumn = scoped.filter((task) => column.statuses.includes(task.status))
    return {
      ...column,
      tasks: column.key === 'done' ? sortDoneColumn(inColumn, sort) : sortTasks(inColumn, sort),
    }
  })
  return (
    <>
      <div className={COLUMNS_LAYOUT}>
        {compact ? (
          <ColumnPicker
            prefix={prefix}
            columns={columns}
            selected={selected}
            onSelect={(key) => onColumnChange(key)}
            focusLeft={pickerFocus}
          />
        ) : null}
        {columns.map((column) => (
          <section
            key={column.key}
            ref={(node) => {
              if (node === null) sections.current.delete(column.key)
              else sections.current.set(column.key, node)
            }}
            {...(compact
              ? {
                  role: 'tabpanel',
                  id: `${prefix}-panel-${column.key}`,
                  'aria-labelledby': `${prefix}-tab-${column.key}`,
                  hidden: column.key !== selected,
                  // 카드 링크도 직접 추가도 없는 칸은 패널이 Tab 자리다 (WAI-ARIA APG 탭 패턴)
                  tabIndex: column.tasks.length === 0 && !canCreate ? 0 : undefined,
                }
              : { 'aria-label': column.title })}
            className={COLUMN_SECTION}
          >
            {compact ? (
              <p className="text-[12.5px] leading-[1.5] text-dim">
                {columnSummary(
                  column.tasks,
                  today,
                  column.key === 'done' ? doneColumnNote(sort) : sortLabel(sort),
                )}
              </p>
            ) : (
              <ColumnHead
                column={column.key}
                mark={column.createAs}
                title={column.title}
                count={column.tasks.length}
                note={columnNote(column.key, column.tasks, today, sort)}
              />
            )}
            <ColumnCards
              workspaceId={workspaceId}
              column={column}
              names={names}
              today={today}
              canCreate={canCreate}
              assignee={assignee}
            />
          </section>
        ))}
      </div>
      {pendingApprovals > 0 ? (
        <p className="text-caption text-dim">
          확인이 필요한 일 <span className="text-ink tabular-nums">{pendingApprovals}</span>건은
          리스트 뷰에서 승인하면 이 보드로 넘어옵니다.
        </p>
      ) : null}
    </>
  )
}

/** 넓은 화면의 칸으로 포커스를 옮긴다. 칸은 Tab 자리가 아니라서 포커스를 가진 동안만 tabindex 를 준다 */
function focusSection(section: HTMLElement | undefined) {
  if (section === undefined) return
  section.tabIndex = -1
  section.addEventListener(
    'blur',
    () => {
      if (section.getAttribute('tabindex') === '-1') section.removeAttribute('tabindex')
    },
    { once: true },
  )
  section.focus()
}

/** 칸 하나와 그 칸에 든 태스크(정렬한 뒤) */
type BoardColumn = (typeof COLUMNS)[number] & { tasks: readonly Task[] }

/** 칸의 카드와 `직접 추가`. 넓은 화면의 칸과 휴대폰의 패널이 같은 인스턴스를 쓴다 */
function ColumnCards({
  workspaceId,
  column,
  names,
  today,
  canCreate,
  assignee,
}: {
  workspaceId: string
  column: BoardColumn
  names: ReadonlyMap<string, string>
  today: string
  canCreate: boolean
  assignee: string | null
}) {
  return (
    <>
      <ul className="flex flex-col gap-10">
        {column.tasks.map((task) => (
          <li key={task.id}>
            <TaskCard
              workspaceId={workspaceId}
              task={task}
              names={names}
              today={today}
              emphasized={column.key === 'active'}
              isPm={canCreate}
            />
          </li>
        ))}
      </ul>
      {canCreate ? (
        <TaskQuickAdd
          workspaceId={workspaceId}
          status={column.createAs}
          columnLabel={column.title}
          assigneeMemberId={assignee}
        />
      ) : null}
    </>
  )
}

/**
 * 휴대폰의 칸 고르기 (PwaTasks 시안). WAI-ARIA 탭 — 화살표·Home·End 로 옮기고 옮긴 탭을 바로 고른다.
 * 탭마다 그 칸의 패널(`${prefix}-panel-${칸}`)을 가리킨다
 */
function ColumnPicker({
  prefix,
  columns,
  selected,
  onSelect,
  focusLeft,
}: {
  prefix: string
  columns: readonly BoardColumn[]
  selected: Column
  onSelect: (column: Column) => void
  /** 사라질 때 포커스를 가졌던 탭의 칸을 적는 곳 */
  focusLeft: RefObject<Column | null>
}) {
  const buttons = useRef(new Map<Column, HTMLButtonElement>())

  // 이 정리는 탭이 DOM 에서 빠지기 전에 돌아 아직 포커스를 읽을 수 있다
  useLayoutEffect(() => {
    const tabs = buttons.current
    return () => {
      for (const [key, button] of tabs)
        if (button === document.activeElement) focusLeft.current = key
    }
  }, [focusLeft])

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = tabKeyTarget(event.key, index, columns.length)
    if (next === null) return
    event.preventDefault()
    const target = columns[next].key
    onSelect(target)
    buttons.current.get(target)?.focus()
  }

  return (
    <div role="tablist" aria-label="상태" className={PICKER}>
      {columns.map(({ key, title, tasks }, index) => {
        const active = key === selected
        return (
          <button
            key={key}
            ref={(node) => {
              if (node === null) buttons.current.delete(key)
              else buttons.current.set(key, node)
            }}
            type="button"
            role="tab"
            id={`${prefix}-tab-${key}`}
            aria-selected={active}
            aria-controls={`${prefix}-panel-${key}`}
            tabIndex={active ? 0 : -1}
            className={PICKER_TAB}
            onClick={() => onSelect(key)}
            onKeyDown={(event) => move(event, index)}
          >
            {/* 읽는 이름이 `진행 중 4` 가 되게 띄운다 */}
            {title} <span className="tabular-nums">{tasks.length}</span>
          </button>
        )
      })}
    </div>
  )
}

/** 카드 테두리·면. 완료는 눌린 면이고, 진행 중 칸과 마감 임박(위험·주의)은 강조 테두리다 — 시작 전 칸의 마감 임박은
    시안에 예가 없어 지금 봐야 하는 카드로 강조한다 */
function cardSurface(tone: TaskTone, emphasized: boolean): string {
  if (tone === 'done') return 'border-divider bg-surface-sunken'
  return emphasized || tone === 'danger' || tone === 'warn'
    ? 'border-line-strong bg-surface'
    : 'border-line bg-surface'
}

function columnNote(column: Column, tasks: readonly Task[], today: string, sort: TaskSort): string {
  if (column === 'todo') {
    // 칸 순서는 정렬마다 달라 첫 마감이 가장 이르다고 볼 수 없다
    const due = tasks.reduce<string | null>(
      (earliest, { dueDate }) =>
        dueDate !== null && (earliest === null || dueDate < earliest) ? dueDate : earliest,
      null,
    )
    return due === null ? '마감일 없음' : `가장 이른 마감 ${shortDate(due)}`
  }
  if (column === 'done') return doneColumnNote(sort)
  const { blocked, danger, warn } = countBadges(tasks, today)
  return `막힘 ${blocked} · 위험 ${danger} · 주의 ${warn}`
}

function ColumnHead({
  column,
  mark,
  title,
  count,
  note,
}: {
  column: Column
  /** 칸 머리 표식은 그 칸에 새로 만드는 태스크의 상태 표식이다 */
  mark: TaskStatus
  title: string
  count: number
  note: string
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-line px-2 pb-12">
      <div className="flex items-center gap-8">
        <TaskStatusMark status={mark} />
        <h2
          className={`flex-1 text-body font-semibold ${column === 'done' ? 'text-dim' : 'text-ink'}`}
        >
          {title}
        </h2>
        <span
          className={`inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-6 px-6 text-[11px] leading-none font-semibold tabular-nums ${
            column === 'active' ? 'bg-ink-solid text-surface' : 'bg-divider text-sub'
          }`}
        >
          {count}
        </span>
      </div>
      <p className="pl-16 text-meta leading-[1.5] text-dim">{note}</p>
    </div>
  )
}

/** 카드 한 장. 상태가 바뀐 태스크만 다시 그린다 — 나머지 카드는 같은 태스크 객체·이름 표를 받는다 (AC-A-04) */
const TaskCard = memo(function TaskCard({
  workspaceId,
  task,
  names,
  today,
  emphasized,
  isPm,
}: {
  workspaceId: string
  task: Task
  names: ReadonlyMap<string, string>
  today: string
  /** 진행 중 칸의 카드다. 시안은 이 칸의 카드를 모두 강조 테두리(`#C9C9C9`)로 그린다 */
  emphasized: boolean
  isPm: boolean
}) {
  const tone = taskTone(task, today)
  const badges = cardBadges(task, today)
  const done = tone === 'done'
  return (
    <article className={`${CARD_BASE} ${cardSurface(tone, emphasized)}`}>
      <div className="flex items-start justify-between gap-8">
        <GuardedLink
          to={paths.tasks(workspaceId, task.id)}
          className={`min-w-[0px] text-[13px] leading-[1.45] wrap-anywhere max-md:text-[15px] ${
            done ? 'font-normal text-dim line-through' : 'font-semibold text-ink'
          }`}
        >
          {task.title}
        </GuardedLink>
        {badges.length === 0 ? null : (
          <div className="flex shrink-0 items-center gap-4">
            {badges.map((badge) =>
              badge === 'blocked' ? (
                <BlockedBadge key={badge} workspaceId={workspaceId} task={task} isPm={isPm} />
              ) : (
                <TonePill key={badge} tone={badge} />
              ),
            )}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-8">
        <span
          className={`inline-flex min-w-[0px] items-center gap-6 text-meta max-md:text-[13px] ${done ? 'text-dim' : 'text-sub'}`}
        >
          <Avatar name={assigneeOf(task, names)} size={21} muted={done} />
          <span className="truncate">{assigneeLabel(task.assigneeMemberId, names)}</span>
        </span>
        <span className="shrink-0 text-meta text-dim tabular-nums max-md:text-[13px]">
          {task.dueDate === null ? '마감 없음' : shortDate(task.dueDate)}
        </span>
      </div>
    </article>
  )
})

function TonePill({ tone }: { tone: 'danger' | 'warn' }) {
  return tone === 'danger' ? (
    <span className={`${PILL} bg-accent-badge font-bold text-accent`}>위험</span>
  ) : (
    <span className={`${PILL} gap-3 bg-ink-solid font-semibold text-surface`}>
      <span aria-hidden="true" className="mr-3 h-5 w-5 rounded-999 bg-current" />
      주의
    </span>
  )
}

/**
 * `막힘` 배지. 누르면 막힌 사유를 보인다. 무응답 자동 막힘이면 `자동 막힘` 이고 PM 은 여기서 풀 수 있다.
 * 제목 링크 옆에 둔다 — 링크 안에는 버튼을 둘 수 없다
 */
function BlockedBadge({
  workspaceId,
  task,
  isPm,
}: {
  workspaceId: string
  task: Task
  isPm: boolean
}) {
  const headingId = useId()
  const autoBlock = useTaskAutoBlock(workspaceId, task)
  const label = autoBlock.automatic ? '자동 막힘' : '막힘'
  const reason = task.blocker?.trim() ?? ''
  return (
    <Popover>
      <PopoverTrigger className={BLOCKED_PILL} aria-label={`${label}, 막힌 사유 보기`}>
        {label}
      </PopoverTrigger>
      <PopoverContent aria-labelledby={headingId}>
        <p id={headingId} className="text-meta leading-none font-semibold text-dim">
          막힌 사유
        </p>
        <p className="text-caption text-ink wrap-anywhere">
          {reason === '' ? '적힌 사유가 없어요' : reason}
        </p>
        <AutoBlockNotice autoBlock={autoBlock} isPm={isPm} />
      </PopoverContent>
    </Popover>
  )
}
