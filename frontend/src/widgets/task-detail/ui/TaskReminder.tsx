import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { CreatedReminder } from '@/entities/message'
import type { Task, TaskStatus } from '@/entities/task'
import { ReminderCreateForm, createdNotice } from '@/features/reminder-create'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Mascot } from '@/shared/ui/mascot'

const CARD = 'overflow-hidden rounded-16 border border-line'
const HEAD =
  'flex flex-wrap items-center justify-between gap-x-16 gap-y-4 border-b border-divider px-20 py-14'
const TITLE = 'flex items-center gap-8 text-[14px] leading-[1.5] font-normal text-ink'
const CHANNEL = 'text-[13px] text-dim'
const BODY = 'flex flex-col gap-12 px-20 py-16'
const ROW = 'flex flex-wrap items-center justify-between gap-x-16 gap-y-10'
const NOTE = 'text-[14px] leading-[1.6] text-sub'
const LINK = 'text-body font-semibold text-ink underline underline-offset-4 hover:text-sub'

/**
 * 태스크 상세의 재촉 (#370, E-5) — PM 이 이 태스크의 담당자에게 보낼 재촉을 만든다. 부른 쪽이 PM 에게만 그린다.
 * 담당자가 없으면 받을 사람이 없고, 완료한 태스크는 재촉하지 않는다 — 서버는 막지 않지만 제품의 기본값이다.
 * 폼은 같은 자리에 펼친다. 만들면 접고 그 자리에 결과와 메시지 화면 링크를 알린다(role=status)
 */
export function TaskReminder({
  workspaceId,
  task,
  status,
  assigneeName,
  overdue,
}: {
  workspaceId: string
  task: Task
  /** 진행 중인 상태 변경을 먼저 반영한 상태 */
  status: TaskStatus
  /** 담당자 이름. 담당자가 없으면 null */
  assigneeName: string | null
  overdue: boolean
}) {
  const titleId = useId()
  const openButtonRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<CreatedReminder | null>(null)
  // 폼을 접으면 연 버튼이 다시 생긴다 — 그 버튼이 그려진 뒤에 포커스를 돌린다
  const close = (result: CreatedReminder | null) => {
    flushSync(() => {
      if (result !== null) setCreated(result)
      setOpen(false)
    })
    openButtonRef.current?.focus()
  }

  let body
  if (task.assigneeMemberId === null)
    body = (
      <p className={NOTE}>담당자가 없어 재촉을 만들 수 없어요. 담당자를 정하면 만들 수 있어요.</p>
    )
  else if (status === 'done') body = <p className={NOTE}>완료한 태스크라 재촉을 만들지 않아요.</p>
  else
    body = (
      <>
        <div role="status" className="flex flex-col items-start gap-6 empty:hidden">
          {created === null ? null : (
            <>
              <p className="text-body text-ink">{createdNotice(created)}</p>
              <GuardedLink
                to={paths.messageReview(workspaceId, created.bundle.id)}
                className={LINK}
              >
                메시지 화면에서 확인하기
              </GuardedLink>
            </>
          )}
        </div>
        {open ? (
          <ReminderCreateForm
            workspaceId={workspaceId}
            target={{ kind: 'task', task }}
            onCreated={close}
            onCancel={() => close(null)}
          />
        ) : (
          <div className={ROW}>
            <p className={NOTE}>
              {overdue ? '마감이 지났어요. ' : ''}보내기 전에 메시지 화면에서 문구를 한 번 더
              확인해요.
            </p>
            <Button
              ref={openButtonRef}
              size="xl"
              onClick={() => {
                setCreated(null)
                setOpen(true)
              }}
            >
              재촉 만들기
            </Button>
          </div>
        )}
      </>
    )

  return (
    <section aria-labelledby={titleId} className={CARD}>
      <div className={HEAD}>
        <h2 id={titleId} className={TITLE}>
          <Mascot size={22} className="shrink-0" />
          {assigneeName ?? '담당자'}에게 진행 상황을 물어볼까요?
        </h2>
        <span className={CHANNEL}>Discord 개인 메시지</span>
      </div>
      <div className={BODY}>{body}</div>
    </section>
  )
}
