import { findMemberWorkspace } from '@/entities/workspace'
import type { Workspace } from '@/entities/workspace'
import { paths } from '@/shared/config/routes'

/**
 * 온보딩 뒤로가기의 목적지 (D-069). 기존 공간에서 새 공간을 만들기 시작했으면 그 공간의 대시보드,
 * 아니면(최초 가입자, 기존 공간이 사라졌거나 그것도 미완료) 워크스페이스 선택 화면이다.
 */
export function onboardingExitPath(
  workspaces: readonly Workspace[],
  returnWorkspaceId: string | null,
): string {
  const back = findMemberWorkspace(workspaces, returnWorkspaceId)
  return back?.onboarding.completed ? paths.dashboard(back.id) : paths.workspaceSelect()
}
