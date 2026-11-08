import { useId } from 'react'
import { ReminderCreateForm, createdNotice } from '@/features/reminder-create'
import { toast } from '@/shared/ui/toast'
import { COMPOSE_COLUMN, COMPOSE_PAGE, COMPOSE_TITLE } from './frame'

export interface ComposeDetailProps {
  workspaceId: string
  /** 스크롤 끝에 둘 여백(px). 마지막 버튼을 정리 중 토스트 위로 꺼낼 수 있게 한다. 토스트가 없으면 0 */
  toastClearance: number
  /** 만든 재촉이 든 묶음. 화면이 그 묶음을 고른다 */
  onCreated: (bundleId: string) => void
  onCancel: () => void
}

/** 새 재촉 — PM 이 팀원과 그 팀원이 맡은 태스크를 골라 재촉을 만든다. 만들면 그 보낼 메시지의 보내기 전 확인으로 간다 */
export function ComposeDetail({
  workspaceId,
  toastClearance,
  onCreated,
  onCancel,
}: ComposeDetailProps) {
  const headingId = useId()
  return (
    <div
      className={COMPOSE_PAGE}
      style={toastClearance > 56 ? { paddingBottom: toastClearance } : undefined}
    >
      <section aria-labelledby={headingId} className={COMPOSE_COLUMN}>
        <div className="flex flex-col gap-8">
          <h2 id={headingId} className={COMPOSE_TITLE}>
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
