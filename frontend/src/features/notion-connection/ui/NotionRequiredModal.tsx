import type { DisconnectedStatus } from '@/entities/integration'
import { paths } from '@/shared/config/routes'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
import { Modal } from '@/shared/ui/modal'

export interface NotionRequiredModalProps {
  workspaceId: string
  /** 미연결이면 D-097 모달, 끊김이면 D-100 모달 */
  reason: DisconnectedStatus | null
  /** `취소`·Esc·배경 클릭 */
  onCancel: () => void
  /** 설정으로 떠나기 직전. 이탈 확인이 이동을 붙잡으면 그 모달만 남도록 화면이 이 모달을 닫는다 */
  onLeave?: () => void
}

/*
 * 제목·버튼은 결정 문서 그대로다. 설명은 「회의를 정리하려면 Notion 을 먼저 연결해야 한다」는 D-097 의 내용을 옮긴 것이다.
 * 돌아오는 곳은 「이 화면」이 아니라 이름으로 적는다 — 연결이 끝나면 늘 회의 올리기로 돌아온다(D-098, D-100). 끊김 모달은
 * 업로드 화면 밖(정리 실패 뒤 회의록 목록·다른 화면)에서도 뜬다. 그때 「이 화면」은 실제 목적지와 다르다 (U4 r1 N01)
 */
const COPY: Record<DisconnectedStatus, { title: string; description: string; connect: string }> = {
  not_connected: {
    title: 'Notion 연결이 필요해요',
    description: '회의를 정리하려면 Notion을 먼저 연결해 주세요. 연결하면 회의 올리기로 돌아와요.',
    connect: 'Notion 연결하기',
  },
  revoked: {
    title: 'Notion 연결이 끊어졌어요',
    description:
      'Notion을 다시 연결한 뒤 회의 파일을 올려 주세요. 연결하면 회의 올리기로 돌아와요.',
    connect: 'Notion 다시 연결하기',
  },
}

/**
 * 회의 올리기를 막는 모달 (D-097, D-100). 연결 버튼은 워크스페이스 설정의 Notion 영역으로 옮기고,
 * 연결이 끝나면 이 공간의 회의 올리기로 돌아오도록 `next` 를 싣는다 (D-098). 연결 자체는 설정이 한다.
 * 정리 실패 뒤의 재연결 모달(U4, D-100)도 같은 컴포넌트를 쓴다.
 */
export function NotionRequiredModal({
  workspaceId,
  reason,
  onCancel,
  onLeave,
}: NotionRequiredModalProps) {
  const navigate = useGuardedNavigate()
  const copy = reason === null ? null : COPY[reason]

  return (
    <Modal
      open={copy !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={copy?.title ?? ''}
      description={copy?.description ?? ''}
      actions={
        <>
          <Button variant="ghost" onClick={onCancel}>
            취소
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onLeave?.()
              navigate(paths.settingsNotion(workspaceId, paths.meetingUpload(workspaceId)))
            }}
          >
            {copy?.connect}
          </Button>
        </>
      }
    />
  )
}
