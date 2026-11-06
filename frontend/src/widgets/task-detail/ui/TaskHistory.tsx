import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import type { ReactNode } from 'react'
import { taskHistoryQueryOptions } from '@/entities/task'
import type { TaskHistoryEntry } from '@/entities/task'
import { useReplyChangeUndo } from '@/features/reply-change-undo'
import type { ReplyChangeUndo } from '@/features/reply-change-undo'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { REPLY_BODY_HIDDEN, historyLine, replyGroup } from '../lib/history'
import type { ReplyGroup } from '../lib/history'

const HEAD = 'flex flex-wrap items-baseline justify-between gap-x-16 gap-y-4 pb-4'
const SECTION_TITLE = 'text-[17px] leading-[1.55] font-bold tracking-h2 text-ink'
const SOURCE_LINK = 'inline-flex items-center gap-4 text-[13px] text-sub hover:text-ink'
/* 대시보드 목록처럼 구분선 줄 — 왼쪽 내용, 오른쪽 「누가 · 어떻게 · 언제」. 좁으면 오른쪽이 아래로 내려간다 */
const ROW =
  'flex flex-wrap items-baseline justify-between gap-x-16 gap-y-4 border-b border-divider py-14'
const CHANGE = 'text-[15px] leading-[1.55] text-ink'
const META = 'text-[13px] text-dim tabular-nums'
const REPLY_CONTENT = 'flex min-w-[0px] flex-[1_1_320px] flex-col gap-8'
const REPLY_QUOTE = 'border-l-2 border-line pl-12 text-body text-sub whitespace-pre-line'
const RESULT_TAG = 'rounded-6 bg-control px-6 py-2 text-caption font-semibold text-sub'

/**
 * 변경 이력. 답장은 그 답장이 바꾼 값과 한 칸으로 묶이고, 그 값은 따로 한 줄이 되지 않는다.
 * PM 은 자동 반영한 값을 그 줄에서 되돌린다. 오른쪽 위는 이 태스크가 나온 회의다
 */
export function TaskHistory({
  workspaceId,
  taskId,
  names,
  isPm,
  meeting,
}: {
  workspaceId: string
  taskId: string
  names: ReadonlyMap<string, string>
  isPm: boolean
  /** 출처 회의. 회의에서 나오지 않은 태스크는 null */
  meeting: { id: string; title: string } | null
}) {
  const titleId = useId()
  const timeline = useQuery(taskHistoryQueryOptions(workspaceId, taskId))
  const undo = useReplyChangeUndo(workspaceId, taskId)
  let body: ReactNode
  if (timeline.data !== undefined)
    body =
      timeline.data.length === 0 ? (
        <p className="pt-10 text-body text-sub">아직 변경 이력이 없어요.</p>
      ) : (
        <ol aria-label="변경 이력">
          {timeline.data.map((item) =>
            item.kind === 'reply' ? (
              <ReplyRow
                key={`reply-${item.id}`}
                group={replyGroup(item, names)}
                undo={isPm ? undo : null}
              />
            ) : (
              <HistoryRow key={item.entry.id} entry={item.entry} names={names} />
            ),
          )}
        </ol>
      )
  else if (timeline.error !== null)
    body = (
      <QueryErrorState
        error={timeline.error}
        title="변경 이력을 불러오지 못했어요"
        onRetry={() => void timeline.refetch()}
      />
    )
  else
    body = (
      <div aria-busy="true">
        <Skeleton lines={3} />
      </div>
    )
  return (
    <section aria-labelledby={titleId} className="flex flex-col">
      <div className={HEAD}>
        <h2 id={titleId} className={SECTION_TITLE}>
          변경 이력
        </h2>
        {meeting === null ? null : (
          <GuardedLink to={paths.meetings(workspaceId, meeting.id)} className={SOURCE_LINK}>
            {meeting.title}에서 나온 일
            <Icon name="link-out" size={12} />
          </GuardedLink>
        )}
      </div>
      {body}
    </section>
  )
}

function HistoryRow({
  entry,
  names,
}: {
  entry: TaskHistoryEntry
  names: ReadonlyMap<string, string>
}) {
  const line = historyLine(entry, names)
  return (
    <li className={ROW}>
      <p className={CHANGE}>
        {line.change}
        {line.rolledBack ? ' (되돌림)' : ''}
      </p>
      <p className={META}>{line.meta}</p>
    </li>
  )
}

/** `undo` 가 null 이면 되돌릴 수 없는 사람이다 */
function ReplyRow({ group, undo }: { group: ReplyGroup; undo: ReplyChangeUndo | null }) {
  const pending = undo?.pendingChangeId ?? null
  return (
    <li className={ROW}>
      <div className={REPLY_CONTENT}>
        {group.body === null ? (
          <p className="text-caption text-dim">{REPLY_BODY_HIDDEN}</p>
        ) : (
          <blockquote className={REPLY_QUOTE}>{group.body}</blockquote>
        )}
        <ul aria-label="답장으로 바뀐 값" className="flex flex-col gap-8">
          {group.changes.map((change) => (
            <li key={change.id} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-8">
                <span className={CHANGE}>{change.change}</span>
                <span className={RESULT_TAG}>{change.result}</span>
                {undo !== null && change.undoable ? (
                  <Button
                    size="sm"
                    loading={pending === change.id}
                    disabled={pending !== null && pending !== change.id}
                    onClick={() => undo.undo(change.id)}
                  >
                    되돌리기
                  </Button>
                ) : null}
              </div>
              {change.summary === null ? null : (
                <p className="text-caption text-dim">{change.summary}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
      <p className={META}>{group.meta}</p>
    </li>
  )
}
