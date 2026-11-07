import { useId } from 'react'
import type { ApprovalDecision } from '@/entities/approval'
import { Button } from '@/shared/ui/button'
import { Icon } from '@/shared/ui/icon'

const ROOT = 'flex flex-wrap items-center justify-between gap-x-16 gap-y-8'
const HINT = 'inline-flex min-w-[0px] flex-1 basis-[240px] items-start gap-6 text-caption'
const BUTTONS = 'ml-auto flex shrink-0 items-center gap-6'

export interface ApprovalActionsProps {
  /** 승인할 수 없는 이유. 있으면 `승인` 을 끄고 안내 자리에 이 문구를 보이며 버튼에 잇는다. null 이면 승인할 수 있다 */
  approveBlockedReason: string | null
  /** 승인할 수 있을 때 안내 자리의 한 줄 (예: 마감을 비워 두면 미정으로 올라가요) */
  note?: string
  onApprove: () => void
  onReject: () => void
  /** 처리 요청 중. 두 버튼 모두 잠근다 */
  pending: boolean
  pendingDecision: ApprovalDecision | null
  /** 충돌을 확인한 뒤의 재승인은 문구가 다르다 */
  approveLabel?: string
}

/**
 * 승인·반려 줄 (계획 §4-2, §4-5, E-6). 반려는 필수값과 무관하게 누를 수 있다.
 * 요청 중에는 둘 다 잠긴다 — 화면 반영은 서버 성공 뒤다
 */
export function ApprovalActions({
  approveBlockedReason,
  note,
  onApprove,
  onReject,
  pending,
  pendingDecision,
  approveLabel = '승인',
}: ApprovalActionsProps) {
  const reasonId = useId()
  const hint = approveBlockedReason ?? note
  return (
    <div className={ROOT}>
      {hint === undefined ? null : (
        <p
          id={approveBlockedReason === null ? undefined : reasonId}
          className={`${HINT} ${approveBlockedReason === null ? 'text-sub' : 'text-ink'}`}
        >
          <Icon name="info" size={14} className="mt-3 shrink-0" />
          {hint}
        </p>
      )}
      <div className={BUTTONS}>
        <Button
          variant="ghost"
          size="xl"
          loading={pendingDecision === 'rejected'}
          disabled={pending}
          onClick={onReject}
        >
          반려
        </Button>
        <Button
          variant="primary"
          size="xl"
          loading={pendingDecision === 'approved'}
          disabled={pending || approveBlockedReason !== null}
          aria-describedby={approveBlockedReason === null ? undefined : reasonId}
          onClick={onApprove}
        >
          {approveLabel}
        </Button>
      </div>
    </div>
  )
}
