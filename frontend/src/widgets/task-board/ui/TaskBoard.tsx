import { useQuery } from '@tanstack/react-query'
import { useId, useMemo, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { pendingApprovalListQueryOptions } from '@/entities/approval'
import type { Approval } from '@/entities/approval'
import { memberListQueryOptions } from '@/entities/member'
import { isDueSoon, isOverdue, taskListQueryOptions, withAssigneeName } from '@/entities/task'
import type { Task, TaskTab } from '@/entities/task'
import { TASK_STATUS_LABEL, useTaskStatusOverlay } from '@/features/task-status'
import { paths } from '@/shared/config/routes'
import { formatSeoulDateTime } from '@/shared/lib/date'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { boardTabs, buildTaskBoard, soonUntil, withPendingStatus } from '../lib/taskBoard'
import type { BoardItem, BoardQuery, DueCondition } from '../lib/taskBoard'

const ROOT = 'mx-auto flex w-full max-w-[960px] flex-col gap-20 px-36 pt-32 pb-56'
const TITLE = 'text-[24px] leading-[1.4] font-bold tracking-h2 text-ink'
const DESCRIPTION = 'text-body text-sub'
const TAB_LIST = 'flex items-center gap-18 border-b border-line'
const TAB =
  'inline-flex h-[38px] items-center gap-7 border-b-2 border-transparent px-3 text-body font-semibold text-sub hover:text-ink aria-selected:border-ink aria-selected:text-ink'
const COUNT =
  'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-6 bg-control px-5 text-[10.5px] font-semibold text-sub tabular-nums'
const FILTERS = 'flex flex-wrap items-center gap-8'
const FILTER =
  'inline-flex h-30 items-center rounded-9 border border-line px-12 text-caption font-semibold text-sub hover:text-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-surface'
const LIST = 'flex flex-col gap-8'
const ROW = 'flex flex-col gap-4 rounded-12 border border-line px-18 py-14'
const ROW_HEAD = 'flex flex-wrap items-center gap-8'
const ROW_TITLE = 'text-body font-semibold text-ink hover:text-sub'
const ROW_META = 'flex flex-wrap items-center gap-x-12 gap-y-2 text-meta text-dim tabular-nums'
const BADGE =
  'inline-flex h-20 items-center rounded-6 bg-control px-7 text-[11px] leading-none font-semibold text-sub'
const ATTENTION_BADGE =
  'inline-flex h-20 items-center rounded-6 bg-ink px-7 text-[11px] leading-none font-semibold text-surface'

const TAB_LABEL: Record<TaskTab, string> = {
  all: '전체',
  needs_review: '확인 필요',
  in_progress: '진행 중',
  done: '완료',
}

const DUE_LABEL: Record<DueCondition, string> = {
  overdue: '기한 지남',
  soon: '7일 안에 마감',
}

export interface TaskBoardProps {
  workspaceId: string
  /** 소속 목록의 역할이 PM 이다. 확인 필요 탭과 대기 승인은 PM 에게만 있다 */
  isPm: boolean
  /** URL 이 정한 탭·날짜 조건. 페이지가 검증해 넘긴다 */
  query: BoardQuery
  /** 서울 오늘 */
  today: string
  /** 탭·날짜 조건을 바꾼다. 페이지가 URL 에 쓴다 */
  onQueryChange: (next: BoardQuery) => void
}

/**
 * 태스크 목록 (M6 §3). 태스크·대기 승인·팀원 세 엔티티와 상태 변경 기능을 조합한다.
 * 일반 팀원은 승인 목록을 부르지 않는다 — 조회 자체가 꺼져 있다 (D-104, D-163).
 * 진행 중인 상태 변경은 목록에 먼저 보인다(`useTaskStatusOverlay`). 탭과 개수가 같은 판정(`buildTaskBoard`)을 쓴다.
 */
export function TaskBoard({ workspaceId, isPm, query, today, onQueryChange }: TaskBoardProps) {
  const tasks = useQuery(taskListQueryOptions(workspaceId))
  const approvals = useQuery({ ...pendingApprovalListQueryOptions(workspaceId), enabled: isPm })
  const members = useQuery(memberListQueryOptions(workspaceId))
  const pending = useTaskStatusOverlay(workspaceId)

  const names = useMemo(
    () => new Map((members.data ?? []).map(({ id, displayName }) => [id, displayName])),
    [members.data],
  )
  const approvalList: readonly Approval[] | null = isPm ? (approvals.data ?? null) : null
  const ready = tasks.data !== undefined && (!isPm || approvals.data !== undefined)
  const board = useMemo(
    () =>
      tasks.data === undefined
        ? null
        : buildTaskBoard(
            {
              tasks: withPendingStatus(tasks.data, pending),
              approvals: approvalList,
              due: query.due,
              today,
            },
            isPm,
            query.tab,
          ),
    [tasks.data, pending, approvalList, query.due, query.tab, today, isPm],
  )

  const failed = tasks.error ?? (isPm ? approvals.error : null)
  let body
  if (ready && board !== null)
    body = (
      <BoardList
        workspaceId={workspaceId}
        items={board.items}
        names={names}
        today={today}
        query={query}
        onQueryChange={onQueryChange}
      />
    )
  else if (failed !== null)
    body = (
      <QueryErrorState
        error={failed}
        title="태스크 목록을 불러오지 못했어요"
        onRetry={() => {
          if (tasks.error !== null) void tasks.refetch()
          if (isPm && approvals.error !== null) void approvals.refetch()
        }}
      />
    )
  else
    body = (
      <div aria-busy="true" className="flex flex-col gap-8">
        <Skeleton lines={4} />
      </div>
    )

  return (
    <main className={ROOT}>
      <header className="flex flex-col gap-4">
        <h1 className={TITLE}>태스크</h1>
        <p className={DESCRIPTION}>
          {isPm
            ? '확인이 필요한 일을 먼저 보고, 팀의 태스크 상태를 관리하세요.'
            : '팀의 태스크를 확인하세요.'}
        </p>
      </header>
      <BoardTabs
        tabs={
          ready && board !== null
            ? board.tabs
            : boardTabs(isPm).map((tab) => ({ tab, count: null }))
        }
        selected={query.tab}
        onSelect={(tab) => onQueryChange({ ...query, tab })}
        panel={
          <div className="flex flex-col gap-16 pt-16">
            <DueFilters query={query} today={today} onQueryChange={onQueryChange} />
            {body}
          </div>
        }
      />
    </main>
  )
}

interface BoardTabsProps {
  tabs: readonly { tab: TaskTab; count: number | null }[]
  selected: TaskTab
  onSelect: (tab: TaskTab) => void
  panel: ReactNode
}

/** WAI-ARIA 탭 — 화살표·Home·End 로 옮기고 옮긴 탭을 바로 고른다. 고른 탭은 URL 에 남는다 */
function BoardTabs({ tabs, selected, onSelect, panel }: BoardTabsProps) {
  const prefix = useId()
  const buttons = useRef(new Map<TaskTab, HTMLButtonElement>())
  const current = tabs.find(({ tab }) => tab === selected) ?? tabs[0]

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys: Record<string, number> = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }
    if (!Object.hasOwn(keys, event.key)) return
    event.preventDefault()
    const target = tabs[keys[event.key]].tab
    onSelect(target)
    buttons.current.get(target)?.focus()
  }

  return (
    <div className="flex flex-col">
      <div role="tablist" aria-label="태스크 구분" className={TAB_LIST}>
        {tabs.map(({ tab, count }, index) => {
          const active = tab === current.tab
          return (
            <button
              key={tab}
              ref={(node) => {
                if (node === null) buttons.current.delete(tab)
                else buttons.current.set(tab, node)
              }}
              type="button"
              role="tab"
              id={`${prefix}-tab-${tab}`}
              aria-selected={active}
              aria-controls={`${prefix}-panel`}
              tabIndex={active ? 0 : -1}
              className={TAB}
              onClick={() => onSelect(tab)}
              onKeyDown={(event) => move(event, index)}
            >
              {TAB_LABEL[tab]}
              {/* 읽는 이름이 `전체 13` 이 되게 띄운다. 모르면 그리지 않는다 */}
              {count === null ? null : (
                <>
                  {' '}
                  <span className={COUNT}>{count}</span>
                </>
              )}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={`${prefix}-panel`}
        aria-labelledby={`${prefix}-tab-${current.tab}`}
        tabIndex={0}
      >
        {panel}
      </div>
    </div>
  )
}

interface DueFiltersProps {
  query: BoardQuery
  today: string
  onQueryChange: (next: BoardQuery) => void
}

/** 날짜 조건. 미완료 태스크에만 걸린다. 조건이 있으면 해제 액션이 보인다 */
function DueFilters({ query, today, onQueryChange }: DueFiltersProps) {
  const toggle = (condition: DueCondition) =>
    onQueryChange({
      ...query,
      due: query.due.includes(condition)
        ? query.due.filter((each) => each !== condition)
        : [...query.due, condition],
    })
  return (
    <div role="group" aria-label="마감 조건" className={FILTERS}>
      {(['overdue', 'soon'] as const).map((condition) => (
        <button
          key={condition}
          type="button"
          aria-pressed={query.due.includes(condition)}
          className={FILTER}
          title={condition === 'soon' ? `${today} ~ ${soonUntil(today)}` : undefined}
          onClick={() => toggle(condition)}
        >
          {DUE_LABEL[condition]}
        </button>
      ))}
      {query.due.length > 0 ? (
        <Button variant="ghost" size="sm" onClick={() => onQueryChange({ ...query, due: [] })}>
          날짜 조건 해제
        </Button>
      ) : null}
    </div>
  )
}

interface BoardListProps {
  workspaceId: string
  items: readonly BoardItem[]
  names: ReadonlyMap<string, string>
  today: string
  query: BoardQuery
  onQueryChange: (next: BoardQuery) => void
}

function BoardList({ workspaceId, items, names, today, query, onQueryChange }: BoardListProps) {
  if (items.length === 0)
    return (
      <div className="flex justify-center pt-32">
        {query.due.length > 0 ? (
          <EmptyState
            titleAs="h2"
            title="조건에 맞는 항목이 없어요"
            description="날짜 조건을 풀면 다른 항목을 볼 수 있어요."
            action={
              <Button onClick={() => onQueryChange({ ...query, due: [] })}>날짜 조건 해제</Button>
            }
          />
        ) : (
          <EmptyState
            titleAs="h2"
            title={query.tab === 'all' ? '아직 태스크가 없어요' : '이 구분에는 항목이 없어요'}
            description="회의를 정리하면 할 일이 여기에 모여요."
          />
        )}
      </div>
    )
  return (
    <ul aria-label="태스크 목록" className={LIST}>
      {items.map((item) =>
        item.kind === 'approval' ? (
          <ApprovalRow
            key={`ap-${item.approval.id}`}
            workspaceId={workspaceId}
            approval={item.approval}
          />
        ) : (
          <TaskRow
            key={`tk-${item.task.id}`}
            workspaceId={workspaceId}
            task={item.task}
            names={names}
            today={today}
          />
        ),
      )}
    </ul>
  )
}

function approvalTitle(approval: Approval): string {
  if (approval.kind === 'unsupported') return approval.type
  return approval.title ?? '제목 없는 확인 요청'
}

function approvalReason(approval: Approval): string {
  if (approval.kind === 'task_update') return '변경 제안을 확인해야 해요'
  if (approval.kind === 'unsupported') return '처리할 수 없는 종류예요'
  const { missing } = approval
  if (missing.includes('assignee') && missing.includes('due')) return '담당자와 마감을 정해야 해요'
  if (missing.includes('assignee')) return '담당자를 정해야 해요'
  if (missing.includes('due')) return '마감을 정해야 해요'
  return '내용을 확인해야 해요'
}

function ApprovalRow({ workspaceId, approval }: { workspaceId: string; approval: Approval }) {
  return (
    <li className={ROW} data-kind="approval">
      <div className={ROW_HEAD}>
        <span className={ATTENTION_BADGE}>확인 필요</span>
        <GuardedLink to={paths.approval(workspaceId, approval.id)} className={ROW_TITLE}>
          {approvalTitle(approval)}
        </GuardedLink>
      </div>
      <p className={ROW_META}>
        <span>{approvalReason(approval)}</span>
        <span>대기 시작 {formatSeoulDateTime(approval.createdAt)}</span>
      </p>
    </li>
  )
}

interface TaskRowProps {
  workspaceId: string
  task: Task
  names: ReadonlyMap<string, string>
  today: string
}

function TaskRow({ workspaceId, task, names, today }: TaskRowProps) {
  const { assigneeName } = withAssigneeName(task, names)
  return (
    <li className={ROW} data-kind="task">
      <div className={ROW_HEAD}>
        <span className={BADGE}>{TASK_STATUS_LABEL[task.status]}</span>
        <GuardedLink to={paths.tasks(workspaceId, task.id)} className={ROW_TITLE}>
          {task.title}
        </GuardedLink>
        {isOverdue(task, today) ? <span className={BADGE}>기한 지남</span> : null}
        {isDueSoon(task, today, soonUntil(today)) ? (
          <span className={BADGE}>7일 안에 마감</span>
        ) : null}
      </div>
      <p className={ROW_META}>
        <span>
          {assigneeName ?? (task.assigneeMemberId === null ? '담당자 없음' : '알 수 없는 담당자')}
        </span>
        <span>{task.dueDate === null ? '마감 없음' : `마감 ${task.dueDate}`}</span>
      </p>
    </li>
  )
}
