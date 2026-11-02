import { useState } from 'react'
import type { IntegrationProvider } from '@/entities/integration'
import { errorMessage } from '@/shared/api/errorMessages'
import { Button } from '@/shared/ui/button'
import { FormErrorPanel } from '@/shared/ui/form-error-panel'
import { Modal } from '@/shared/ui/modal'
import { toast } from '@/shared/ui/toast'
import { useDisconnectIntegration } from '../model/useDisconnectIntegration'
import { CARD_BUTTON } from './connectionStyles'

const PROVIDER_NAME: Record<IntegrationProvider, string> = { discord: 'Discord', notion: 'Notion' }

/** 연결된 카드의 앞 버튼. 대응 API 가 없어 누르면 준비 중이라고만 알린다 */
const SECONDARY_ACTION: Record<IntegrationProvider, string> = {
  discord: '채널 바꾸기',
  notion: '속성 다시 맞추기',
}

/* Settings 캔버스 `연결` 절 머리말과 같은 문장이다 — 끊기 전에 무엇이 남는지 다시 알린다 */
const DISCONNECT_DESCRIPTION =
  '연결을 끊으면 이미 반영한 내용은 그대로 남고, 새 내용만 쓰지 않게 됩니다.'

export interface ConnectionActionsProps {
  workspaceId: string
  provider: IntegrationProvider
  /** 서버가 끊은 뒤, 카드가 미연결로 바뀌기 직전에 부른다. 이 버튼들은 그때 사라진다 — 카드가 포커스를 받아 간다 */
  onDisconnected?: () => void
}

/**
 * 연결된 카드의 PM 조작 — `채널 바꾸기`/`속성 다시 맞추기` 와 `연결 끊기` (Settings 캔버스).
 * 끊기는 확인 모달을 거친다. 서버가 끊은 뒤에만 상태가 바뀐다 (D-137). 실패하면 모달에 남아 다시 시도할 수 있다
 */
export function ConnectionActions({
  workspaceId,
  provider,
  onDisconnected,
}: ConnectionActionsProps) {
  const [confirming, setConfirming] = useState(false)
  const disconnect = useDisconnectIntegration(workspaceId, provider, onDisconnected)
  const name = PROVIDER_NAME[provider]
  const secondary = SECONDARY_ACTION[provider]

  const close = (open: boolean) => {
    if (open || disconnect.isPending) return
    setConfirming(false)
    disconnect.reset()
  }

  return (
    <>
      <Button
        size="md-compact"
        className={CARD_BUTTON}
        onClick={() => toast.show({ title: `${secondary}는 아직 준비 중이에요.` })}
      >
        {secondary}
      </Button>
      <Button
        variant="ghost"
        size="md-compact"
        className={CARD_BUTTON}
        onClick={() => setConfirming(true)}
      >
        연결 끊기
      </Button>
      <Modal
        open={confirming}
        onOpenChange={close}
        title={`${name} 연결을 끊을까요?`}
        description={DISCONNECT_DESCRIPTION}
        actions={
          <>
            <Button variant="ghost" disabled={disconnect.isPending} onClick={() => close(false)}>
              취소
            </Button>
            <Button
              variant="primary"
              loading={disconnect.isPending}
              onClick={() =>
                disconnect.mutate(undefined, { onSuccess: () => setConfirming(false) })
              }
            >
              연결 끊기
            </Button>
          </>
        }
      >
        <FormErrorPanel message={disconnect.isError ? errorMessage(disconnect.error) : null} />
      </Modal>
    </>
  )
}
