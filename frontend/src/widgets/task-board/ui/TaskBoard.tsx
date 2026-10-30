import { useQuery } from '@tanstack/react-query'
import type { RefetchOptions } from '@tanstack/react-query'
import { Suspense, lazy, useId, useMemo, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { pendingApprovalListQueryOptions } from '@/entities/approval'
import type { Approval } from '@/entities/approval'
import { meetingListQueryOptions } from '@/entities/meeting'
import { memberListQueryOptions } from '@/entities/member'
import type { Member } from '@/entities/member'
import { isDueSoon, isOverdue, taskListQueryOptions, withAssigneeName } from '@/entities/task'
import type { Task, TaskTab } from '@/entities/task'
import { TASK_STATUS_LABEL, useTaskStatusOverlay } from '@/features/task-status'
import { COMMON_MESSAGES } from '@/shared/api/errorMessages'
import { paths } from '@/shared/config/routes'
import { seoulDateOf, soonUntil } from '@/shared/lib/date'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { boardTabs, buildTaskBoard, withPendingStatus } from '../lib/taskBoard'
import type { BoardItem, BoardQuery } from '../lib/taskBoard'
import {
  createApprovals,
  filterTasksByAssignee,
  memberNames,
  mondayOf,
  monthOf,
  queryView,
  shortDate,
  VIEW_LABEL,
} from '../lib/taskViews'
import type { ViewQuery } from '../lib/taskViews'
import { ApprovalCard } from './ApprovalCard'
import { AssigneeFilter, DueFilter, PeriodFilter, ViewSwitch } from './ViewControls'
import { Avatar } from './viewParts'

/* 보드·캘린더·간트는 그 보기를 고를 때 코드를 받는다 (M8 AC-A-02). 리스트로 들어오면 셋 다 내려받지 않는다 */
const BoardView = lazy(() =>
  import('./BoardView').then(({ BoardView }) => ({ default: BoardView })),
)
const CalendarView = lazy(() =>
  import('./CalendarView').then(({ CalendarView }) => ({ default: CalendarView })),
)
const GanttView = lazy(() =>
  import('./GanttView').then(({ GanttView }) => ({ default: GanttView })),
)

/* Tasks 시안 — main 패딩 48/48/72, 블록 사이 28px.
 * 리스트 본문 단은 상세·확인 필요 상세와 같이 960px 이하로 가운데에 둔다.
 * 보드·캘린더·간트는 시안 셸 폭을 유지한다. */
const PAGE = 'mx-auto flex w-full max-w-shell flex-1 justify-center px-48 pt-48 pb-72'
const PAGE_LIST = 'mx-auto flex w-full max-w-[960px] flex-1 justify-center px-48 pt-48 pb-72'
const COLUMN = 'flex w-full max-w-column flex-col gap-28'
const COLUMN_WIDE = 'flex w-full flex-col gap-20'
const TITLE = 'text-[28px] leading-[1.25] font-bold tracking-h1 text-ink'
const DESCRIPTION = 'text-body text-sub'
const TOOLBAR = 'flex flex-wrap items-center justify-between gap-16'
const TAB_LIST = 'inline-flex gap-[17px]'
const TAB =
  'inline-flex h-32 items-center gap-7 border-b-2 border-transparent px-3 text-control font-semibold text-sub hover:text-ink aria-selected:border-ink aria-selected:text-ink'
const COUNT = 'text-meta font-normal text-dim tabular-nums'
const ATTENTION_COUNT =
  'inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-999 bg-ink px-5 text-[10.5px] font-normal leading-none text-surface tabular-nums'
const CARDS = 'flex flex-col gap-28'
const SECTION = 'flex flex-col gap-12'
const SECTION_HEAD = 'flex items-center justify-between pt-12'
const SECTION_TITLE = 'text-[14px] leading-[1.75] font-semibold text-ink'
const ROW = 'flex items-center gap-14 border-b border-line py-14 last:border-b-0'
const ROW_TITLE = 'min-w-[0px] text-[14px] font-semibold text-ink hover:text-sub'
const BADGE =
  'inline-flex h-[21px] shrink-0 items-center rounded-6 bg-control px-8 text-meta leading-none font-semibold text-sub'
const ASSIGNEE = 'inline-flex shrink-0 items-center gap-7 text-caption text-dim'
const DUE = 'shrink-0 text-caption text-dim tabular-nums'
const EMPTY_UPLOAD =
  'inline-flex h-40 items-center justify-center rounded-9 bg-ink px-20 text-body font-semibold text-surface hover:bg-dim active:bg-sub'

const TAB_LABEL: Record<TaskTab, string> = {
  all: '전체',
  needs_review: '확인 필요',
  in_progress: '진행 중',
  done: '완료',
}

const DESCRIPTIONS: Record<ViewQuery['view'], (isPm: boolean) => string> = {
  list: (isPm) =>
    isPm
      ? '담당자별로 걸러 보고, 준비된 태스크를 Notion에 반영하세요.'
      : '팀의 태스크를 확인하세요.',
  board: () => '승인이 끝난 일만 올라옵니다 — Notion 보드와 같은 상태예요.',
  calendar: () => '마감일 기준입니다. 날짜가 없는 일은 아래 칸에 모아 뒀어요.',
  gantt: () => '간트차트로 일정을 한 눈에 볼 수 있어요.',
}

/** 보기가 쓰는 조회 하나. 받지 못했을 때 알리는 이름과 다시 부를 조회다 */
interface ViewSource {
  name: string
  query: {
    data: unknown
    error: unknown
    isFetching: boolean
    refetch: (options?: RefetchOptions) => Promise<unknown>
  }
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
  /** URL 이 정한 보기·담당자·기간 */
  view: ViewQuery
  onViewChange: (next: ViewQuery) => void
}

/** Notion 에 반영된 태스크. `synced` 만 반영 완료다 — 페이지 ID 만으로는 아니다 */
function reflectedTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => task.notionSyncStatus === 'synced')
}

/**
 * 태스크 화면 (M6 §3 · Tasks 시안 4장). 태스크·대기 승인·팀원 세 엔티티와 상태 변경 기능을 조합한다.
 * 일반 팀원은 승인 목록을 부르지 않는다 — 조회 자체가 꺼져 있다 (D-104, D-163).
 * 보기는 리스트·보드·캘린더·간트 넷이고 URL(`view`)이 정한다. 리스트에서는 확인 필요 항목을 카드에서 바로 처리한다 (`ApprovalCard`).
 * 진행 중인 상태 변경은 목록에 먼저 보인다(`useTaskStatusOverlay`). 탭과 개수가 같은 판정(`buildTaskBoard`)을 쓴다.
 */
export function TaskBoard({
  workspaceId,
  isPm,
  query,
  today,
  onQueryChange,
  view,
  onViewChange,
}: TaskBoardProps) {
  const tasks = useQuery(taskListQueryOptions(workspaceId))
  const approvals = useQuery({ ...pendingApprovalListQueryOptions(workspaceId), enabled: isPm })
  const members = useQuery(memberListQueryOptions(workspaceId))
  // 카드의 회의 링크 이름과 캘린더의 회의 칩에만 쓴다. 못 받아도 화면은 그린다
  const meetings = useQuery({
    ...meetingListQueryOptions(workspaceId),
    enabled: isPm || view.view === 'calendar',
  })
  const pending = useTaskStatusOverlay(workspaceId)

  const names = useMemo(() => memberNames(members.data), [members.data])
  const meetingTitles = useMemo(
    () => new Map((meetings.data ?? []).map(({ id, title }) => [id, title])),
    [meetings.data],
  )
  const approvalList: readonly Approval[] | null = isPm ? (approvals.data ?? null) : null
  const ready = tasks.data !== undefined && (!isPm || approvals.data !== undefined)
  // 진행 중인 상태 변경을 겹친 태스크. 담당자 조건은 리스트·보드에만 건다
  const overlaid = useMemo(
    () => (tasks.data === undefined ? null : withPendingStatus(tasks.data, pending)),
    [tasks.data, pending],
  )
  const filtered = useMemo(
    () => (overlaid === null ? null : filterTasksByAssignee(overlaid, view.assignee)),
    [overlaid, view.assignee],
  )
  const board = useMemo(
    () =>
      filtered === null
        ? null
        : buildTaskBoard(
            { tasks: filtered, approvals: approvalList, due: query.due, today },
            isPm,
            query.tab,
          ),
    [filtered, approvalList, query.due, query.tab, today, isPm],
  )

  const isList = view.view === 'list'
  const wide = view.view === 'calendar' || view.view === 'gantt'
  const memberList = members.data ?? []

  // 보드·캘린더·간트가 쓰는 조회 (M8 AC-A-05). 처음부터 받지 못한 태스크만 보기 전체 오류다. 확인 필요·팀원·회의를 받지 못했거나
  // 기존 데이터의 재조회가 실패하면 받은 데이터로 보기를 그리고 위에서 알린다 — 실패를 빈 목록이나 `담당자 없음` 으로 그리지 않는다
  const sources: ViewSource[] = [
    { name: '태스크', query: tasks },
    ...(isPm ? [{ name: '확인 필요', query: approvals }] : []),
    { name: '팀원', query: members },
    ...(view.view === 'calendar' ? [{ name: '회의', query: meetings }] : []),
  ]
  const missing =
    isList || queryView(tasks) === 'error'
      ? []
      : sources.filter(({ query }) => {
          const state = queryView(query)
          return state === 'refreshFailed' || state === 'error'
        })

  let body: ReactNode
  if (isList) {
    const failed = tasks.error ?? (isPm ? approvals.error : null)
    if (ready && board !== null && filtered !== null)
      body = (
        <BoardList
          workspaceId={workspaceId}
          items={board.items}
          reflected={query.tab === 'needs_review' ? reflectedTasks(filtered) : []}
          members={members.data}
          meetingTitles={meetingTitles}
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
  } else if (queryView(tasks) === 'error')
    body = (
      <QueryErrorState
        error={tasks.error}
        title="태스크 목록을 불러오지 못했어요"
        onRetry={() => void tasks.refetch()}
      />
    )
  else if (
    overlaid === null ||
    filtered === null ||
    sources.some(({ query }) => queryView(query) === 'loading')
  )
    body = <ViewLoading label="태스크를 불러오는 중" />
  // 받은 태스크도 확인 필요도 없다. 확인 필요를 받지 못했으면 비었다고 하지 않는다
  else if (overlaid.length === 0 && (!isPm || approvalList?.length === 0))
    body = (
      <div className="flex justify-center pt-32">
        <EmptyState
          titleAs="h2"
          title="아직 태스크가 없어요"
          description="회의를 정리하면 할 일이 여기에 모여요."
        />
      </div>
    )
  else if (view.view === 'board')
    body = (
      <BoardView
        workspaceId={workspaceId}
        tasks={filtered}
        names={names}
        today={today}
        period={view.period}
        pendingApprovals={approvalList?.length ?? 0}
      />
    )
  else if (view.view === 'calendar')
    body = (
      <CalendarView
        workspaceId={workspaceId}
        tasks={overlaid}
        approvals={createApprovals(approvalList ?? [])}
        meetings={(meetings.data ?? []).flatMap(({ id, title, startedAt }) => {
          const date = seoulDateOf(startedAt)
          return date === null ? [] : [{ id, title, date }]
        })}
        names={names}
        today={today}
        month={view.month ?? monthOf(today)}
        onMonthChange={(month) => onViewChange({ ...view, month })}
      />
    )
  else
    body = (
      <GanttView
        workspaceId={workspaceId}
        members={memberList}
        tasks={overlaid}
        approvals={createApprovals(approvalList ?? [])}
        today={today}
        from={view.from ?? mondayOf(today)}
        onFromChange={(from) => onViewChange({ ...view, from })}
      />
    )

  const assigneeFilter = (
    <AssigneeFilter
      bordered={view.view === 'board'}
      members={memberList}
      value={view.assignee}
      onChange={(assignee) => onViewChange({ ...view, assignee })}
    />
  )

  return (
    <main className={view.view === 'list' ? PAGE_LIST : PAGE}>
      <div className={wide ? COLUMN_WIDE : COLUMN}>
        <header className="flex items-end justify-between gap-24">
          <div className="flex flex-col gap-5">
            <h1 className={TITLE}>태스크</h1>
            <p className={DESCRIPTION}>{DESCRIPTIONS[view.view](isPm)}</p>
          </div>
          <ViewSwitch
            value={view.view}
            onChange={(next) => onViewChange({ ...view, view: next })}
          />
        </header>
        {isList ? (
          <BoardTabs
            tabs={
              ready && board !== null
                ? board.tabs
                : boardTabs(isPm).map((tab) => ({ tab, count: null }))
            }
            selected={query.tab}
            onSelect={(tab) => onQueryChange({ ...query, tab })}
            trailing={
              <div className="flex flex-wrap items-center gap-8">
                <div role="group" aria-label="마감 조건">
                  <DueFilter
                    value={query.due}
                    today={today}
                    last={soonUntil(today)}
                    onChange={(due) => onQueryChange({ ...query, due })}
                  />
                </div>
                {assigneeFilter}
              </div>
            }
            panel={body}
          />
        ) : (
          <>
            {view.view === 'board' ? (
              <div className="flex items-center gap-8">
                {assigneeFilter}
                <PeriodFilter
                  value={view.period}
                  onChange={(period) => onViewChange({ ...view, period })}
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-20">
              {missing.length === 0 ? null : (
                <PartialFailureNotice
                  names={missing.map(({ name }) => name)}
                  retrying={missing.some(({ query }) => query.isFetching)}
                  onRetry={() => {
                    // 진행 중인 조회는 새로 보내지 않고 기다린다 — 두 번 눌러도 요청이 늘지 않는다
                    for (const { query } of missing) void query.refetch({ cancelRefetch: false })
                  }}
                />
              )}
              {/* 보기마다 새 경계다 — 보기 전환(transition)에도 이전 보기를 붙잡지 않고 이 자리에 대기를 그린다 */}
              <Suspense
                key={view.view}
                fallback={<ViewLoading label={`${VIEW_LABEL[view.view]} 화면을 불러오는 중`} />}
              >
                {body}
              </Suspense>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

/** 보기 자리의 대기. 이름으로 코드 대기(`보드 화면을 불러오는 중`)와 조회 대기(`태스크를 불러오는 중`)를 구분한다 */
function ViewLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-8">
      <Skeleton lines={4} />
    </div>
  )
}

interface PartialFailureNoticeProps {
  /** 받지 못한 조회 이름. `확인 필요·팀원` 처럼 잇는다 */
  names: readonly string[]
  retrying: boolean
  onRetry: () => void
}

/** 일부 조회를 받지 못했다 — 받은 데이터로 그린 보기 위에 둔다. 다시 시도는 받지 못한 조회만 다시 부른다 */
function PartialFailureNotice({ names, retrying, onRetry }: PartialFailureNoticeProps) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-8 text-caption text-dim">
      <span>{names.join('·')} 정보를 불러오지 못했어요. 보이는 내용이 전부가 아닐 수 있어요.</span>
      <Button size="sm" loading={retrying} onClick={onRetry}>
        {COMMON_MESSAGES.retry}
      </Button>
    </div>
  )
}

interface BoardTabsProps {
  tabs: readonly { tab: TaskTab; count: number | null }[]
  selected: TaskTab
  onSelect: (tab: TaskTab) => void
  /** 탭 줄 오른쪽 끝에 놓는 조건 */
  trailing: ReactNode
  panel: ReactNode
}

/** WAI-ARIA 탭 — 화살표·Home·End 로 옮기고 옮긴 탭을 바로 고른다. 고른 탭은 URL 에 남는다 */
function BoardTabs({ tabs, selected, onSelect, trailing, panel }: BoardTabsProps) {
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
    <div className="flex flex-col gap-28">
      <div className={TOOLBAR}>
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
                {/* 읽는 이름이 `전체 13` 이 되게 띄운다. 모르면 그리지 않는다. 확인 필요만 먹 알약이다 */}
                {count === null ? null : (
                  <>
                    {' '}
                    <span className={tab === 'needs_review' && count > 0 ? ATTENTION_COUNT : COUNT}>
                      {count}
                    </span>
                  </>
                )}
              </button>
            )
          })}
        </div>
        {trailing}
      </div>
      <div
        role="tabpanel"
        id={`${prefix}-panel`}
        aria-labelledby={`${prefix}-tab-${current.tab}`}
        tabIndex={0}
        className="flex flex-col gap-28"
      >
        {panel}
      </div>
    </div>
  )
}

interface BoardListProps {
  workspaceId: string
  items: readonly BoardItem[]
  /** 확인 필요 탭 아래에 보이는 `이미 반영된 일` */
  reflected: readonly Task[]
  members: readonly Member[] | undefined
  meetingTitles: ReadonlyMap<string, string>
  names: ReadonlyMap<string, string>
  today: string
  query: BoardQuery
  onQueryChange: (next: BoardQuery) => void
}

function BoardList({
  workspaceId,
  items,
  reflected,
  members,
  meetingTitles,
  names,
  today,
  query,
  onQueryChange,
}: BoardListProps) {
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
        ) : query.tab === 'needs_review' ? (
          // EmptyTasks 시안
          <EmptyState
            titleAs="h2"
            pose="squint"
            title="확인할 게 없어요"
            description="새 회의를 올리면 확인이 필요한 것만 여기에 모아 드릴게요."
            action={
              <GuardedLink to={paths.meetingUpload(workspaceId)} className={EMPTY_UPLOAD}>
                회의 올리기
              </GuardedLink>
            }
            secondaryAction={
              <Button
                variant="ghost"
                size="lg"
                endIcon={<Icon name="chevron-right" size={14} />}
                onClick={() => onQueryChange({ ...query, tab: 'done' })}
              >
                이미 반영된 일 보기
              </Button>
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

  const approvals = items.flatMap((item) => (item.kind === 'approval' ? [item.approval] : []))
  const tasks = items.flatMap((item) => (item.kind === 'task' ? [item.task] : []))
  return (
    <>
      {approvals.length === 0 ? null : (
        <ul aria-label="확인 필요 목록" className={CARDS}>
          {approvals.map((approval) => (
            <li key={`ap-${approval.id}`}>
              <ApprovalCard
                workspaceId={workspaceId}
                approval={approval}
                members={members}
                meetingTitles={meetingTitles}
              />
            </li>
          ))}
        </ul>
      )}
      {tasks.length === 0 ? null : (
        <section className={SECTION} aria-label="태스크">
          {approvals.length === 0 ? null : (
            <div className={SECTION_HEAD}>
              <h2 className={SECTION_TITLE}>
                태스크 <span className="font-normal text-dim tabular-nums">{tasks.length}</span>
              </h2>
            </div>
          )}
          <ul aria-label="태스크 목록">
            {tasks.map((task) => (
              <TaskRow
                key={`tk-${task.id}`}
                workspaceId={workspaceId}
                task={task}
                names={names}
                today={today}
              />
            ))}
          </ul>
        </section>
      )}
      {reflected.length === 0 ? null : (
        <section className={SECTION} aria-label="이미 반영된 일">
          <div className={SECTION_HEAD}>
            <h2 className={SECTION_TITLE}>
              이미 반영된 일{' '}
              <span className="font-normal text-dim tabular-nums">{reflected.length}</span>
            </h2>
            <span className="text-caption text-dim">확실한 건만 자동으로 올렸어요</span>
          </div>
          <ul aria-label="이미 반영된 일 목록">
            {reflected.map((task) => (
              <TaskRow
                key={`rf-${task.id}`}
                workspaceId={workspaceId}
                task={task}
                names={names}
                today={today}
                reflected
              />
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

interface TaskRowProps {
  workspaceId: string
  task: Task
  names: ReadonlyMap<string, string>
  today: string
  /** 이미 반영된 일 행이다. 상태 대신 `반영됨` 배지를 둔다 */
  reflected?: boolean
}

/** 시안의 `이미 반영된 일` 행 — 배지 · 제목 · 담당자(이니셜 원) · 마감 `MM/DD` */
function TaskRow({ workspaceId, task, names, today, reflected = false }: TaskRowProps) {
  const { assigneeName } = withAssigneeName(task, names)
  return (
    <li className={ROW} data-kind="task">
      <span className={BADGE}>{reflected ? '반영됨' : TASK_STATUS_LABEL[task.status]}</span>
      <div className="flex min-w-[0px] flex-1 flex-wrap items-center gap-8">
        <GuardedLink to={paths.tasks(workspaceId, task.id)} className={ROW_TITLE}>
          {task.title}
        </GuardedLink>
        {!reflected && isOverdue(task, today) ? <span className={BADGE}>기한 지남</span> : null}
        {!reflected && isDueSoon(task, today, soonUntil(today)) ? (
          <span className={BADGE}>7일 안에 마감</span>
        ) : null}
      </div>
      {assigneeName === null || assigneeName === undefined ? (
        <span className={ASSIGNEE}>
          {task.assigneeMemberId === null ? '담당자 없음' : '알 수 없는 담당자'}
        </span>
      ) : (
        <span className={ASSIGNEE}>
          <Avatar name={assigneeName} />
          {assigneeName}
        </span>
      )}
      {task.dueDate === null ? (
        <span className={DUE}>마감 없음</span>
      ) : (
        <time dateTime={task.dueDate} aria-label={`마감 ${task.dueDate}`} className={DUE}>
          {shortDate(task.dueDate)}
        </time>
      )}
    </li>
  )
}
