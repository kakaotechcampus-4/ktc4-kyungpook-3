/** 워크스페이스 범위 key 의 첫 칸. 워크스페이스 목록 key(`['workspace-list']`)와 접두어가 겹치지 않는다 */
export const WORKSPACE_SCOPE = 'workspace'

/**
 * 워크스페이스 범위 데이터의 key 는 반드시 이 함수로 만든다. 두 번째 칸이 workspaceId 다 (D-136).
 * 공간마다 key 가 달라서 전환 직후 이전 공간의 캐시가 새 화면에 섞이지 않는다.
 */
export function workspaceKey<const Parts extends readonly unknown[]>(
  workspaceId: string,
  ...parts: Parts
) {
  return [WORKSPACE_SCOPE, workspaceId, ...parts] as const
}
