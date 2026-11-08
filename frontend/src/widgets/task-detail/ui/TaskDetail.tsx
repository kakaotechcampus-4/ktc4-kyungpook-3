import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { meetingListQueryOptions } from '@/entities/meeting'
import { memberListQueryOptions } from '@/entities/member'
import { TASK_STATUS_LABEL, isOverdue, taskDetailQueryOptions } from '@/entities/task'
import type { Task } from '@/entities/task'
import { TaskStatusControl, useTaskStatusOverlay } from '@/features/task-status'
import { COMMON_MESSAGES } from '@/shared/api/errorMessages'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { monthDayOf } from '@/shared/lib/date'
import { queryView } from '@/shared/lib/query-view'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { useLoadingIndicator } from '@/shared/lib/loading-indicator'
import { Button } from '@/shared/ui/button'
import { EmptyState } from '@/shared/ui/empty-state'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { DeferredSkeleton, Reveal } from '@/shared/ui/deferred-skeleton'
import { assigneeLabel } from '../lib/history'
import { TaskDetailSkeleton } from './TaskDetailSkeleton'
import { BACK, ROOT } from './frame'
import { TaskHistory } from './TaskHistory'
import { TaskInfoPanel } from './TaskInfoPanel'
import { TaskReminder } from './TaskReminder'

/* 태스크 목록·보드와 같은 960 컨테이너 — 본문 864px */
const HEADER = 'flex flex-wrap items-end justify-between gap-x-24 gap-y-16'
const TITLE = 'text-[30px] leading-[1.3] font-bold tracking-h2 text-ink wrap-anywhere'
const SUBLINE = 'flex flex-wrap items-center gap-8 text-[15px] text-sub'
/* 대시보드 마감 임박의 「기한 지남」과 같은 테두리 배지 */
const OVERDUE =
  'inline-flex h-[21px] shrink-0 items-center rounded-6 border border-accent bg-surface px-8 text-meta leading-none font-semibold text-accent'
const STATUS_BADGE =
  'inline-flex h-32 shrink-0 items-center rounded-9 bg-control px-13 text-control font-semibold text-ink'
const LINK = 'text-body font-semibold text-ink underline underline-offset-4 hover:text-sub'

export interface TaskDetailProps {
  workspaceId: string
  taskId: string
  /** 소속 목록의 역할이 PM 이다. 상태·담당자·마감 바꾸기와 재촉은 PM 에게만 있다 */
  isPm: boolean
  /** 서울 기준 오늘 `YYYY-MM-DD`. 기한 지남을 가른다 */
  today: string
}

/** 볼 수 없는 태스크 — 없거나 다른 공간의 것이다. 다시 시도해도 같아서 목록으로 돌려보낸다 */
function isUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === ERROR_CODES.TASK_NOT_FOUND ||
      error.code === ERROR_CODES.WORKSPACE_MISMATCH ||
      (error.kind === 'http' && error.status === 404))
  )
}

/**
 * 태스크 상세 (M6 §3-5, E-5). 머리에 이름·담당·마감과 상태, 아래에 태스크 정보·재촉·변경 이력.
 * Notion 반영 상태는 서버 상태만 따르고, 반영 중이면 이 화면에 있는 동안 polling 한다. PM 은 반영 실패를 다시 요청한다 (§4-7, §4-8).
 * 담당자·마감이 없는 기존 태스크도 그대로 읽는다. PM 만 상태를 바로 바꾸고, 담당자·마감을 고쳐 함께 저장하고, 재촉을 만든다.
 * 진행 중인 상태 변경은 여기에도 먼저 보인다(`useTaskStatusOverlay`).
 */
export function TaskDetail({ workspaceId, taskId, isPm, today }: TaskDetailProps) {
  const task = useQuery(taskDetailQueryOptions(workspaceId, taskId))
  // 이미 받는 중이면 새 요청을 보내지 않는다
  const retryRefresh = () => void task.refetch({ cancelRefetch: false })

  const view = queryView(task)
  const indicator = useLoadingIndicator(view === 'loading')

  let body: ReactNode
  if (task.data !== undefined)
    body = (
      <>
        {view === 'refreshFailed' ? (
          <RefreshFailedNotice retrying={task.isFetching} onRetry={retryRefresh} />
        ) : null}
        <TaskBody workspaceId={workspaceId} task={task.data} isPm={isPm} today={today} />
      </>
    )
  else if (view === 'error' && isUnavailable(task.error))
    body = <UnavailableTask workspaceId={workspaceId} />
  else if (view === 'error')
    body = (
      <QueryErrorState
        error={task.error}
        title="태스크를 불러오지 못했어요"
        onRetry={() => void task.refetch()}
      />
    )
  else body = null
  body = indicator.pending ? (
    <DeferredSkeleton indicator={indicator}>
      <TaskDetailSkeleton />
    </DeferredSkeleton>
  ) : (
    <Reveal indicator={indicator}>{body}</Reveal>
  )

  return (
    <main className={ROOT}>
      <GuardedLink to={paths.tasks(workspaceId)} className={BACK}>
        <Icon name="chevron-left" size={14} />
        태스크 목록
      </GuardedLink>
      {/* 제목은 태스크 이름이다. 아직 없으면 화면 이름을 읽어 준다 */}
      {task.data === undefined ? <h1 className="sr-only">태스크</h1> : null}
      {body}
    </main>
  )
}

/**
 * 데이터는 있으나 마지막 재조회가 실패했다 (#236, 대시보드 E-02 와 같은 판정). 본문은 그대로 두고 이 안내만 위에 둔다.
 * 재조회가 성공하면 사라진다. 요청 중에는 버튼이 비활성이다
 */
function RefreshFailedNotice({ retrying, onRetry }: { retrying: boolean; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-8 text-caption text-dim">
      <span>최신 상태를 받지 못했어요</span>
      <span aria-hidden="true">·</span>
      <Button size="sm" loading={retrying} onClick={onRetry}>
        {COMMON_MESSAGES.retry}
      </Button>
    </div>
  )
}

export function UnavailableTask({ workspaceId }: { workspaceId: string }) {
  return (
    <div className="flex justify-center pt-32">
      <EmptyState
        titleAs="h2"
        title="이 태스크를 볼 수 없어요"
        description="삭제됐거나 이 워크스페이스의 태스크가 아니에요."
        action={
          <GuardedLink to={paths.tasks(workspaceId)} className={LINK}>
            태스크 목록으로
          </GuardedLink>
        }
      />
    </div>
  )
}

function TaskBody({
  workspaceId,
  task,
  isPm,
  today,
}: {
  workspaceId: string
  task: Task
  isPm: boolean
  today: string
}) {
  const members = useQuery(memberListQueryOptions(workspaceId))
  // 처리 추적이 이미 받는 목록이다 — 같은 key 라 따로 요청하지 않는다
  const meetings = useQuery(meetingListQueryOptions(workspaceId))
  const pending = useTaskStatusOverlay(workspaceId)
  const names = useMemo(
    () => new Map((members.data ?? []).map(({ id, displayName }) => [id, displayName])),
    [members.data],
  )
  const status = pending.get(task.id) ?? task.status
  const overdue = isOverdue({ ...task, status }, today)
  const assignee =
    task.assigneeMemberId === null ? null : assigneeLabel(task.assigneeMemberId, names)
  const meeting =
    task.meetingId === null
      ? null
      : {
          id: task.meetingId,
          title: meetings.data?.find(({ id }) => id === task.meetingId)?.title ?? '연결된 회의',
        }

  return (
    <>
      <div className={HEADER}>
        <div className="flex min-w-[0px] flex-col gap-10">
          <h1 className={TITLE}>{task.title}</h1>
          <p className={SUBLINE}>
            <span>
              {assignee === null ? (
                '담당자 없음'
              ) : (
                <>
                  <span className="font-bold text-ink">{assignee}</span> 담당
                </>
              )}
              {' · '}
              {task.dueDate === null ? (
                '마감 없음'
              ) : (
                <>
                  <time
                    dateTime={task.dueDate}
                    className={`font-bold tabular-nums ${overdue ? 'text-accent' : 'text-ink'}`}
                  >
                    {monthDayOf(task.dueDate)}
                  </time>{' '}
                  마감
                </>
              )}
            </span>
            {overdue ? <span className={OVERDUE}>기한 지남</span> : null}
          </p>
        </div>
        {isPm ? (
          <TaskStatusControl workspaceId={workspaceId} taskId={task.id} status={status} />
        ) : (
          <span data-testid="task-status" className={STATUS_BADGE}>
            {TASK_STATUS_LABEL[status]}
          </span>
        )}
      </div>
      <TaskInfoPanel
        workspaceId={workspaceId}
        task={task}
        status={status}
        names={names}
        isPm={isPm}
      />
      {isPm ? (
        <TaskReminder
          workspaceId={workspaceId}
          task={task}
          status={status}
          assigneeName={assignee}
          overdue={overdue}
        />
      ) : null}
      <TaskHistory
        workspaceId={workspaceId}
        taskId={task.id}
        names={names}
        isPm={isPm}
        meeting={meeting}
      />
    </>
  )
}
