/*
 * 새 워크스페이스 온보딩에서 뒤로가기로 돌아갈 기존 공간 ID (D-069).
 * 서버 데이터가 아니라 화면 흐름 상태다. OAuth 는 현재 탭 이동이라 메모리 상태가 사라지므로
 * 같은 탭의 sessionStorage 에 둔다 (G5 예외: 복귀할 워크스페이스 ID). 사용자·워크스페이스 객체는 두지 않는다.
 */

const KEY = 'onboarding-return-workspace'

/** 막힌 저장소(사생활 모드 등)에서는 조용히 넘어간다 — 복귀 대상이 없으면 선택 화면으로 간다 */
function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function rememberReturnWorkspace(workspaceId: string | null): void {
  try {
    if (workspaceId === null) storage()?.removeItem(KEY)
    else storage()?.setItem(KEY, workspaceId)
  } catch {
    // 저장하지 못해도 온보딩은 계속된다
  }
}

export function readReturnWorkspace(): string | null {
  try {
    return storage()?.getItem(KEY) ?? null
  } catch {
    return null
  }
}

export function clearReturnWorkspace(): void {
  rememberReturnWorkspace(null)
}
