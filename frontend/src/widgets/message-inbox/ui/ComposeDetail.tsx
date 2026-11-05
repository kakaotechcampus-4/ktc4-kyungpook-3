import { useId } from 'react'
import { ReminderCreateForm, createdNotice } from '@/features/reminder-create'
import { toast } from '@/shared/ui/toast'

/* 보내기 전 확인과 같은 가운데 604 열이다(ReviewDetail) */
const PAGE = 'flex flex-1 justify-center overflow-y-auto px-36 pt-44 pb-56'
const COLUMN = 'flex w-full max-w-[604px] flex-col gap-24 self-start'
const TITLE = 'text-[28px] leading-[1.25] font-bold tracking-h1 text-ink'

export interface ComposeDetailProps {
  workspaceId: string
  /** 만든 재촉이 든 묶음. 화면이 그 묶음을 고른다 */
  onCreated: (bundleId: string) => void
  onCancel: () => void
}

/** 새 재촉 — PM 이 팀원과 그 팀원이 맡은 태스크를 골라 재촉을 만든다. 만들면 그 보낼 메시지의 보내기 전 확인으로 간다 */
export function ComposeDetail({ workspaceId, onCreated, onCancel }: ComposeDetailProps) {
  const headingId = useId()
  return (
    <div className={PAGE}>
      <section aria-labelledby={headingId} className={COLUMN}>
        <div className="flex flex-col gap-8">
          <h2 id={headingId} className={TITLE}>
            새 재촉
          </h2>
          <p className="text-[14px] text-sub">
            팀원이 맡은 태스크의 진행 상황을 Discord 개인 메시지로 물어봐요. 만든 뒤 승인해야
            나가요.
          </p>
        </div>
        <ReminderCreateForm
          workspaceId={workspaceId}
          target={{ kind: 'choose' }}
          onCreated={(created) => {
            toast.show({ key: 'message-review-action', title: createdNotice(created) })
            onCreated(created.bundle.id)
          }}
          onCancel={onCancel}
        />
      </section>
    </div>
  )
}
