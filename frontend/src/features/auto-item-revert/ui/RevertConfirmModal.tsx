import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'

export interface RevertConfirmModalProps {
  /** 되돌릴 항목의 제목. null 이면 닫혀 있다 */
  title: string | null
  /** 요청이 진행 중이다. 그동안 닫지 않고 두 번 보내지 않는다 */
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * 되돌리기 확인 (D-036, Main 시안의 되돌리기 모달). 무엇이 바뀌는지 먼저 말한다 —
 * 자동으로 만든 태스크가 지워지고 같은 내용의 확인 필요가 새로 생긴다. 취소하면 아무것도 바꾸지 않는다
 */
export function RevertConfirmModal({
  title,
  pending,
  onConfirm,
  onCancel,
}: RevertConfirmModalProps) {
  return (
    <Modal
      open={title !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel()
      }}
      title="자동 반영을 되돌릴까요?"
      description={
        <>
          자동으로 만든 <strong className="text-ink">{title}</strong> 태스크를 지우고, 같은 내용으로
          확인 필요를 새로 만들어요. 확인 필요에서 승인하면 태스크가 다시 생기고, 반려하면 그대로
          끝나요.
        </>
      }
      actions={
        <>
          <Button variant="ghost" disabled={pending} onClick={onCancel}>
            취소
          </Button>
          <Button variant="primary" loading={pending} onClick={onConfirm}>
            되돌리기
          </Button>
        </>
      }
    />
  )
}
