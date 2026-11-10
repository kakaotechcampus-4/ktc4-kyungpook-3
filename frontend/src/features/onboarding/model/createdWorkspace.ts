import type { Workspace } from '@/entities/workspace'

/**
 * 만들기 응답을 읽지 못한 뒤 방금 만든 공간을 찾는다 (#348 리뷰). 보내기 전에 없던, 같은 이름의, 내가 PM 인 공간이
 * 하나일 때만 그 공간이다. 보내기 전 목록을 몰랐거나 후보가 없거나 여럿이면 null 이다 — 짐작해 이어 가지 않는다
 */
export function findCreatedWorkspace(
  latest: readonly Workspace[],
  name: string,
  knownBefore: ReadonlySet<string> | null,
): Workspace | null {
  if (knownBefore === null) return null
  const candidates = latest.filter(
    (workspace) =>
      !knownBefore.has(workspace.id) && workspace.name === name && workspace.role === 'pm',
  )
  return candidates.length === 1 ? candidates[0] : null
}
