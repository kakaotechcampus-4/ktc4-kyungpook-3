import type { Workspace } from '@/entities/workspace'

/**
 * 공간의 보조 줄. 캔버스의 `팀원 5명 · 확인 필요 3` 은 집계 API 가 필요해 쓰지 않는다 (M4 는 집계를 요청하지 않는다).
 * 미완료 공간은 `설정 미완료`(D-070), 완료 공간은 내 역할이다.
 */
export function workspaceMeta(workspace: Workspace): string {
  if (!workspace.onboarding.completed) return '설정 미완료'
  return workspace.role === 'pm' ? 'PM' : '팀원'
}
