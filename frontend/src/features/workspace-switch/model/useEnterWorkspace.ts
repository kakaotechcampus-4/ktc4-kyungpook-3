import { useCallback } from 'react'
import { workspaceEntryPath } from '@/entities/workspace'
import type { Workspace } from '@/entities/workspace'
import { rememberReturnWorkspace } from '@/shared/lib/return-workspace'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'

/**
 * 공간에 들어가는 한 가지 방법. 선택 화면과 헤더 메뉴가 같이 쓴다 (D-066, D-070).
 * - 완료 공간 → 그 대시보드. 보던 기능 화면을 따라가지 않는다
 * - 설정 미완료 공간 → 저장된 온보딩 재개 지점
 * 미완료 공간으로 들어갈 때는 온보딩 나가기(D-069)가 돌아올 공간을 함께 적는다 —
 * 헤더에서는 지금 보던 공간, 선택 화면에서는 없음(null)이다. 이전에 남은 기억을 쓰지 않는다.
 * 이동은 관문을 탄다 — 저장하지 않은 변경이 있으면 먼저 묻는다 (D-067).
 */
export function useEnterWorkspace(): (
  workspace: Workspace,
  fromWorkspaceId: string | null,
) => void {
  const navigate = useGuardedNavigate()
  return useCallback(
    (workspace, fromWorkspaceId) => {
      if (!workspace.onboarding.completed) rememberReturnWorkspace(fromWorkspaceId)
      navigate(workspaceEntryPath(workspace))
    },
    [navigate],
  )
}
