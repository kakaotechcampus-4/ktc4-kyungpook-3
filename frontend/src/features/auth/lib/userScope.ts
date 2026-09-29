import type { QueryClient } from '@tanstack/react-query'
import { SESSION_QUERY_KEY } from '@/entities/user'
import { workspaceListQueryOptions } from '@/entities/workspace'
import type { Workspace } from '@/entities/workspace'
import { clearReturnWorkspace } from '@/shared/lib/return-workspace'
import { clearUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { toast } from '@/shared/ui/toast'

const isSessionQuery = (queryKey: readonly unknown[]) => queryKey[0] === SESSION_QUERY_KEY[0]

/**
 * 사용자가 바뀌는 순간(로그인·가입·로그아웃) 이전 사용자의 흔적을 지운다.
 * 진행 중인 요청을 모두 취소하고 세션을 뺀 캐시를 전부 버린다. 저장하지 않은 변경 등록과 알림도 푼다.
 * 온보딩 뒤로가기의 복귀 공간 기억도 지운다 — 다음 사용자의 나가기가 앞 사용자의 공간으로 가지 않는다.
 *
 * **세션 캐시는 여기서 지우지 않는다.** 세션 query 를 없애면 그것을 구독하는 가드가 `/auth/me` 를
 * 다시 불러 새 사용자를 먼저 보고 제멋대로 이동한다. 세션 값은 호출자가 이동과 같은 틱에 바꾼다.
 */
export async function clearUserScope(queryClient: QueryClient): Promise<void> {
  clearUnsavedChanges()
  clearReturnWorkspace()
  toast.clear()
  await queryClient.cancelQueries()
  queryClient.removeQueries({ predicate: ({ queryKey }) => !isSessionQuery(queryKey) })
}

/** 새 사용자의 워크스페이스 목록을 서버에서 새로 받는다. 이 목록으로 로그인 뒤 갈 곳을 정한다 (D-010) */
export function fetchFreshWorkspaces(queryClient: QueryClient): Promise<Workspace[]> {
  return queryClient.fetchQuery({ ...workspaceListQueryOptions(), staleTime: 0 })
}
