import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'

export interface MoveConfirmProps {
  /** 연결을 풀 팀원. null 이면 닫혀 있다 */
  fromName: string | null
  onConfirm: () => void
  onCancel: () => void
}

/** 다른 팀원에 연결된 계정을 골랐다. 앞 팀원에게서 무엇이 바뀌는지 말하고 묻는다 — 이름은 그대로, 연결만 풀린다 */
export function MoveConfirm({ fromName, onConfirm, onCancel }: MoveConfirmProps) {
  return (
    <Modal
      open={fromName !== null}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      title={`${fromName ?? ''} 님에서 옮길까요?`}
      description={`${fromName ?? ''} 님은 이름이 그대로 남고 디스코드 연결만 풀려요.`}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            취소
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            옮기기
          </Button>
        </>
      }
    />
  )
}
