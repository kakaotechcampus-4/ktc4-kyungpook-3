import type { QueryClient } from '@tanstack/react-query'
import { SESSION_QUERY_KEY, sessionQueryOptions } from '@/entities/user'
import { clearUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { toast } from '@/shared/ui/toast'

/**
 * 401 을 받았을 때 부른다. 세션 캐시에 사용자가 있을 때만 「인증된 세션의 만료」다. 처리했으면 true.
 * - 최초 /auth/me 의 401 은 세션이 아직 없거나 null 이라 아무것도 하지 않는다 (비로그인)
 * - 여러 요청이 동시에 401 이어도 첫 번째가 세션을 null 로 바꿔서 나머지는 그냥 지나간다
 * - 네트워크 실패는 401 이 아니라서 여기에 오지 않는다
 *
 * 로그인 이동은 직접 하지 않는다. 세션 query 를 지우지 않고 값만 null 로 바꾸면 그것을 구독하는
 * RequireAuth 가 보호 화면을 내리고 로그인으로 한 번 보낸다. 여기서도 navigate 하면 이동이 두 번 된다.
 */
export function expireSession(queryClient: QueryClient): boolean {
  const { queryKey } = sessionQueryOptions()
  if (!queryClient.getQueryData(queryKey)) return false

  // 세션이 끝나 저장할 방법이 없다. 등록과 저장해 둔 이동(열린 이탈 모달)을 먼저 푼다
  // 로그인 이동은 가드의 <Navigate> 라 관문을 지나지 않지만, 로그인 화면에 모달과 beforeunload 가 남으면 안 된다
  clearUnsavedChanges()
  // 이전 사용자에게 띄운 알림도 남기지 않는다
  toast.clear()
  void queryClient.cancelQueries()
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_QUERY_KEY[0] })
  queryClient.setQueryData(queryKey, null)
  return true
}
