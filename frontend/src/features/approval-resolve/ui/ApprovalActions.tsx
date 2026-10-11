import { useId } from 'react'
import type { ApprovalDecision } from '@/entities/approval'
import { Button } from '@/shared/ui/button'

const ROOT = 'flex flex-col items-end gap-8'
const BUTTONS = 'flex items-center gap-10'
const REASON = 'max-w-[520px] text-right text-caption text-sub'

export interface ApprovalActionsProps {
  /** 승인할 수 없는 이유. 있으면 `승인` 을 끄고 이 문구를 버튼 가까이에 보인다. null 이면 승인할 수 있다 */
  approveBlockedReason: string | null
  onApprove: () => void
  onReject: () => void
  /** 처리 요청 중. 두 버튼 모두 잠근다 */
  pending: boolean
  pendingDecision: ApprovalDecision | null
  /** 충돌을 확인한 뒤의 재승인은 문구가 다르다 */
  approveLabel?: string
}

/**
 * 승인·반려 버튼 (계획 §4-2, §4-5). 반려는 필수값과 무관하게 누를 수 있다.
 * 요청 중에는 둘 다 잠긴다 — 화면 반영은 서버 성공 뒤다
 */
export function ApprovalActions({
  approveBlockedReason,
  onApprove,
  onReject,
  pending,
  pendingDecision,
  approveLabel = '승인',
}: ApprovalActionsProps) {
  const reasonId = useId()
  return (
    <div className={ROOT}>
      <div className={BUTTONS}>
        <Button
          variant="outline"
          size="lg"
          loading={pendingDecision === 'rejected'}
          disabled={pending}
          onClick={onReject}
        >
          반려
        </Button>
        <Button
          variant="primary"
          size="lg"
          loading={pendingDecision === 'approved'}
          disabled={pending || approveBlockedReason !== null}
          aria-describedby={approveBlockedReason === null ? undefined : reasonId}
          onClick={onApprove}
        >
          {approveLabel}
        </Button>
      </div>
      {approveBlockedReason === null ? null : (
        <p id={reasonId} className={REASON}>
          {approveBlockedReason}
        </p>
      )}
    </div>
  )
}
