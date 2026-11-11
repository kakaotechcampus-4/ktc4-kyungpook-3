import { useId } from 'react'
import type { ReactNode, Ref } from 'react'
import type { MeetingRef } from '@/entities/project-map'
import { TASK_STATUS_LABEL, TaskStatusMark } from '@/entities/task'
import type { TaskStatus } from '@/entities/task'
import { paths } from '@/shared/config/routes'
import { seoulDateOf } from '@/shared/lib/date'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { NOTE, ROW_META, SECTION_TITLE } from './frame'

/* 옆 패널(주제·태스크)이 함께 쓰는 조각 */

export const BODY = 'flex flex-col gap-24'
export const LIST = 'flex flex-col gap-10'
export const LINK = 'text-body font-semibold text-ink underline-offset-4 hover:underline'
const TASK_BUTTON = 'flex w-full items-center gap-8 text-left text-body text-ink hover:text-sub'

export function Section({
  title,
  headingRef,
  children,
}: {
  title: string
  /** 줄이 사라진 뒤 포커스를 받을 제목 */
  headingRef?: Ref<HTMLHeadingElement>
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-10">
      <h3
        id={id}
        ref={headingRef}
        tabIndex={headingRef === undefined ? undefined : -1}
        className={`${SECTION_TITLE} outline-none`}
      >
        {title}
      </h3>
      {children}
    </section>
  )
}

export function TaskLine({
  status,
  title,
  onOpen,
}: {
  status: TaskStatus
  title: string
  onOpen?: () => void
}) {
  const content = (
    <>
      <TaskStatusMark status={status} />
      <span className="min-w-[0px] flex-1">{title}</span>
      <span className={ROW_META}>{TASK_STATUS_LABEL[status]}</span>
    </>
  )
  return onOpen === undefined ? (
    <span className="flex items-center gap-8 text-body text-ink">{content}</span>
  ) : (
    <button type="button" className={TASK_BUTTON} onClick={onOpen}>
      {content}
    </button>
  )
}

export function MeetingLinks({
  workspaceId,
  meetings,
}: {
  workspaceId: string
  meetings: readonly MeetingRef[]
}) {
  if (meetings.length === 0) return <p className={NOTE}>나온 회의가 없어요.</p>
  return (
    <ul className={LIST}>
      {meetings.map(({ meetingId, title, startedAt }) => (
        <li key={meetingId} className="flex items-baseline justify-between gap-12">
          <GuardedLink to={paths.meetings(workspaceId, meetingId)} className={LINK}>
            {title ?? '제목 없는 회의'}
          </GuardedLink>
          <span className={ROW_META}>{seoulDateOf(startedAt)}</span>
        </li>
      ))}
    </ul>
  )
}
