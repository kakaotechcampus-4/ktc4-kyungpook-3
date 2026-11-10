import type { ReactNode } from 'react'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'
import { ALERT } from './styles'

export interface EditConfirmProps {
  title: string
  description: ReactNode
  confirmLabel: string
  pending: boolean
  /** 서버가 거절한 이유 */
  failure: string | null
  /** 고를 것이 남았다 (합칠 주제) */
  confirmDisabled?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
}

/** 되돌리기 어려운 고치기(합치기·떼기·지우기)의 확인 창. 연 동안만 그린다. 보내는 중에는 닫히지 않는다 */
export function EditConfirm({
  title,
  description,
  confirmLabel,
  pending,
  failure,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
}: EditConfirmProps) {
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel()
      }}
      title={title}
      description={description}
      actions={
        <>
          <Button variant="ghost" disabled={pending} onClick={onCancel}>
            취소
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {failure === null ? null : (
        <p role="alert" className={ALERT}>
          {failure}
        </p>
      )}
    </Modal>
  )
}
