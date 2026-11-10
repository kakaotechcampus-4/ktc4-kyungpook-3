import type { InvitedAccount } from '@/entities/invitation'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'

export interface RevokeConfirmProps {
  open: boolean
  displayName: string
  /** 수락한 계정. 지워졌으면 null */
  account: InvitedAccount | null
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}

const TAIL =
  '계정은 이 워크스페이스에 더는 들어올 수 없어요. 팀원 기록과 맡은 일은 그대로 남고, 다시 이으려면 새로 초대해야 해요.'

/** 연결 끊기는 끊긴 사람이 되돌릴 수 없어 먼저 묻는다. 무엇이 남고 무엇이 사라지는지 말한다 */
export function RevokeConfirm({
  open,
  displayName,
  account,
  pending,
  onConfirm,
  onCancel,
}: RevokeConfirmProps) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel()
      }}
      title={`${displayName}의 계정 연결을 끊을까요?`}
      description={
        account === null
          ? `연결된 ${TAIL}`
          : `${account.email === null ? account.name : `${account.name}(${account.email})`} ${TAIL}`
      }
      actions={
        <>
          <Button variant="ghost" disabled={pending} onClick={onCancel}>
            닫기
          </Button>
          <Button variant="primary" loading={pending} onClick={onConfirm}>
            연결 끊기
          </Button>
        </>
      }
    />
  )
}
