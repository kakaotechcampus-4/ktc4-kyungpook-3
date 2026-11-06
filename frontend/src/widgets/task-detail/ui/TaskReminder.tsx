import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { CreatedReminder } from '@/entities/message'
import type { Task, TaskStatus } from '@/entities/task'
import { ReminderCreateForm, createdNotice } from '@/features/reminder-create'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'

const SECTION_TITLE = 'text-[17px] leading-[1.55] font-bold tracking-h2 text-ink'
const LINK = 'text-body font-semibold text-ink underline underline-offset-4 hover:text-sub'

/**
 * 태스크 상세의 재촉 (#370) — PM 이 이 태스크의 담당자에게 보낼 재촉을 만든다. 부른 쪽이 PM 에게만 그린다.
 * 담당자가 없으면 받을 사람이 없고, 완료한 태스크는 재촉하지 않는다 — 서버는 막지 않지만 제품의 기본값이다.
 * 폼은 같은 자리에 펼친다. 만들면 접고 그 자리에 결과와 메시지 화면 링크를 알린다(role=status)
 */
export function TaskReminder({
  workspaceId,
  task,
  status,
}: {
  workspaceId: string
  task: Task
  /** 진행 중인 상태 변경을 먼저 반영한 상태 */
  status: TaskStatus
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
      <p className="text-body text-sub">
        담당자가 없어 재촉을 만들 수 없어요. 담당자를 정하면 만들 수 있어요.
      </p>
    )
  else if (status === 'done')
    body = <p className="text-body text-sub">완료한 태스크라 재촉을 만들지 않아요.</p>
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
          <div>
            <Button
              ref={openButtonRef}
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
    <section aria-labelledby={titleId} className="flex flex-col gap-12">
      <h3 id={titleId} className={SECTION_TITLE}>
        재촉
      </h3>
      {body}
    </section>
  )
}
