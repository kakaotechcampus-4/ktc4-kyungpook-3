import { Outlet } from 'react-router'
import { useProcessingTracker } from '@/features/meeting-processing'
import { NotionRequiredModal } from '@/features/notion-connection'

/**
 * 로그인한 사용자의 화면 전체를 감싼다. 회의 정리 추적기를 여기 하나 둔다 —
 * 화면·워크스페이스를 옮겨도 polling 이 끊기지 않고, 로그아웃하면 이 칸이 내려가며 함께 멈춘다 (U4-1, U4-3).
 * 정리 중 Notion 연결이 끊겨 실패하면 재연결 모달을 띄운다(D-100). 두 feature 를 잇는 것은 앱 계층이다 (G4).
 */
export function AuthenticatedLayout() {
  const { revokedWorkspaceId, dismissRevoked } = useProcessingTracker()
  return (
    <>
      <Outlet />
      <NotionRequiredModal
        workspaceId={revokedWorkspaceId ?? ''}
        reason={revokedWorkspaceId === null ? null : 'revoked'}
        onCancel={dismissRevoked}
        onLeave={dismissRevoked}
      />
    </>
  )
}
