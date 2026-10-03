import type { Workspace } from '../model/types'

/**
 * 소속은 `GET /workspaces` 목록에 있는지로만 판정한다. 목록은 소속 공간만 돌려준다.
 * 상세 응답의 `role`(DTO 상 Optional, null 이면 mapper 가 member 로 폴백)은 소속 근거가 아니다 (계약 §4.0-①).
 */
export function findMemberWorkspace(
  workspaces: readonly Workspace[],
  workspaceId: string | null,
): Workspace | null {
  if (workspaceId === null) return null
  return workspaces.find(({ id }) => id === workspaceId) ?? null
}
