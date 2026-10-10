import { useQuery } from '@tanstack/react-query'
import { useId, useMemo } from 'react'
import type { ReactNode } from 'react'
import { meetingListQueryOptions } from '@/entities/meeting'
import { memberListQueryOptions } from '@/entities/member'
import { taskDetailQueryOptions, taskHistoryQueryOptions } from '@/entities/task'
import type { Task } from '@/entities/task'
import { TASK_STATUS_LABEL, TaskStatusControl, useTaskStatusOverlay } from '@/features/task-status'
import { ApiError, ERROR_CODES } from '@/shared/api/errors'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { EmptyState } from '@/shared/ui/empty-state'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { assigneeLabel, historyLine } from '../lib/history'

const ROOT = 'mx-auto flex w-full max-w-[960px] flex-col gap-24 px-36 pt-32 pb-56'
const BACK = 'text-caption font-semibold text-dim hover:text-ink'
const EYEBROW = 'text-caption font-semibold text-dim'
const TITLE = 'text-[24px] leading-[1.4] font-bold tracking-h2 text-ink'
const FIELDS =
  'grid grid-cols-[120px_1fr] gap-x-16 gap-y-12 rounded-16 border border-line px-24 py-20'
const TERM = 'text-caption font-semibold text-dim'
const VALUE = 'text-body text-ink tabular-nums'
const SECTION_TITLE = 'text-[17px] leading-[1.55] font-bold tracking-h2 text-ink'
const HISTORY = 'flex flex-col gap-10'
const HISTORY_ROW = 'flex flex-col gap-2 border-b border-line pb-10'
const HISTORY_META = 'text-meta text-dim tabular-nums'
const LINK = 'text-body font-semibold text-ink underline underline-offset-4 hover:text-sub'

export interface TaskDetailProps {
  workspaceId: string
  taskId: string
  /** 소속 목록의 역할이 PM 이다. 상태 바꾸기는 PM 에게만 있다 */
  isPm: boolean
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
 * 태스크 상세 (M6 §3-5). 담당자·상태·마감·진행률·막힌 사유·연결 회의·변경 이력을 읽는다.
 * 담당자·마감이 없는 기존 태스크도 그대로 읽는다. PM 만 상태를 바꾼다 — 다른 필드 편집은 없다.
 * 진행 중인 상태 변경은 여기에도 먼저 보인다(`useTaskStatusOverlay`).
 */
export function TaskDetail({ workspaceId, taskId, isPm }: TaskDetailProps) {
  const task = useQuery(taskDetailQueryOptions(workspaceId, taskId))

  let body: ReactNode
  if (task.data !== undefined)
    body = <TaskBody workspaceId={workspaceId} task={task.data} isPm={isPm} />
  else if (task.error !== null && isUnavailable(task.error))
    body = <UnavailableTask workspaceId={workspaceId} />
  else if (task.error !== null)
    body = (
      <QueryErrorState
        error={task.error}
        title="태스크를 불러오지 못했어요"
        onRetry={() => void task.refetch()}
      />
    )
  else
    body = (
      <div aria-busy="true">
        <Skeleton lines={5} />
      </div>
    )

  return (
    <main className={ROOT}>
      <div className="flex flex-col gap-6">
        <GuardedLink to={paths.tasks(workspaceId)} className={BACK}>
          ← 태스크 목록
        </GuardedLink>
        <h1 className={EYEBROW}>태스크</h1>
      </div>
      {body}
    </main>
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

function TaskBody({ workspaceId, task, isPm }: { workspaceId: string; task: Task; isPm: boolean }) {
  const members = useQuery(memberListQueryOptions(workspaceId))
  // 처리 추적이 이미 받는 목록이다 — 같은 key 라 따로 요청하지 않는다
  const meetings = useQuery(meetingListQueryOptions(workspaceId))
  const pending = useTaskStatusOverlay(workspaceId)
  const names = useMemo(
    () => new Map((members.data ?? []).map(({ id, displayName }) => [id, displayName])),
    [members.data],
  )
  const status = pending.get(task.id) ?? task.status
  const meetingTitle =
    task.meetingId === null
      ? null
      : (meetings.data?.find(({ id }) => id === task.meetingId)?.title ?? '연결된 회의')

  return (
    <>
      <h2 className={TITLE}>{task.title}</h2>
      <dl aria-label="태스크 정보" className={FIELDS}>
        <dt className={TERM}>담당자</dt>
        <dd className={VALUE}>{assigneeLabel(task.assigneeMemberId, names)}</dd>
        <dt className={TERM}>상태</dt>
        <dd className={`${VALUE} flex flex-wrap items-center gap-16`}>
          <span data-testid="task-status">{TASK_STATUS_LABEL[status]}</span>
          {isPm ? (
            <TaskStatusControl workspaceId={workspaceId} taskId={task.id} status={status} />
          ) : null}
        </dd>
        <dt className={TERM}>마감</dt>
        <dd className={VALUE}>{task.dueDate ?? '마감 없음'}</dd>
        <dt className={TERM}>진행률</dt>
        <dd className={VALUE}>{task.progress === null ? '기록 없음' : `${task.progress}%`}</dd>
        <dt className={TERM}>막힌 사유</dt>
        <dd className={VALUE}>{task.blocker ?? '없음'}</dd>
        <dt className={TERM}>연결 회의</dt>
        <dd className={VALUE}>
          {task.meetingId === null || meetingTitle === null ? (
            '없음'
          ) : (
            <GuardedLink to={paths.meetings(workspaceId, task.meetingId)} className={LINK}>
              {meetingTitle}
            </GuardedLink>
          )}
        </dd>
      </dl>
      <TaskHistory workspaceId={workspaceId} taskId={task.id} names={names} />
    </>
  )
}

function TaskHistory({
  workspaceId,
  taskId,
  names,
}: {
  workspaceId: string
  taskId: string
  names: ReadonlyMap<string, string>
}) {
  const titleId = useId()
  const history = useQuery(taskHistoryQueryOptions(workspaceId, taskId))
  let body: ReactNode
  if (history.data !== undefined)
    body =
      history.data.length === 0 ? (
        <p className="text-body text-sub">아직 변경 이력이 없어요.</p>
      ) : (
        <ol aria-label="변경 이력" className={HISTORY}>
          {history.data.map((entry) => {
            const line = historyLine(entry, names)
            return (
              <li key={line.id} className={HISTORY_ROW}>
                <p className="text-body text-ink">
                  {line.change}
                  {line.rolledBack ? ' (되돌림)' : ''}
                </p>
                <p className={HISTORY_META}>{line.meta}</p>
              </li>
            )
          })}
        </ol>
      )
  else if (history.error !== null)
    body = (
      <QueryErrorState
        error={history.error}
        title="변경 이력을 불러오지 못했어요"
        onRetry={() => void history.refetch()}
      />
    )
  else
    body = (
      <div aria-busy="true">
        <Skeleton lines={3} />
      </div>
    )
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-12">
      <h3 id={titleId} className={SECTION_TITLE}>
        변경 이력
      </h3>
      {body}
    </section>
  )
}
