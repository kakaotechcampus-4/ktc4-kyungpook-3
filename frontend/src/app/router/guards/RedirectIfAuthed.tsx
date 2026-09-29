import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Navigate, Outlet } from 'react-router'
import { sessionQueryOptions } from '@/entities/user'
import { authRevisitPath, postLoginPath, workspaceListQueryOptions } from '@/entities/workspace'
import { RouteSkeleton } from '../RouteSkeleton'
import { ScreenError } from './ScreenError'

/**
 * 랜딩·로그인·회원가입의 바깥 칸. 비로그인이거나 세션 조회가 실패했으면 공개 화면을 그대로 보여 준다.
 * 목록 조회는 로그인했을 때만 구독한다 — 비로그인에게 401 을 한 번 더 만들지 않는다.
 *
 * 로그인한 사용자를 어디로 보낼지는 **이 칸에서 비로그인을 본 적이 있는지**로 가른다.
 * - 본 적이 없다: 로그인한 채로 인증 화면에 다시 왔다 → 마지막 공간 먼저 (`authRevisitPath`, D-131)
 * - 본 적이 있다: 여기서 방금 로그인·가입했다 → 공간 개수 분기 (`postLoginPath`, D-010)
 *
 * 다른 탭에서 로그인해 이 탭의 세션 재조회가 사용자를 받아도 `postLoginPath` 다. 이 탭에서 로그인한 것은 아니지만
 * 비로그인 화면을 보던 사람에게는 로그인 직후와 같은 경험이고, 두 규칙 모두 유효한 화면으로 보내 고치지 않는다.
 *
 * 로그인 폼이 직접 옮기지 않는 까닭 — 라우터 이동은 transition 이라 세션 캐시 갱신보다 늦게 그려진다.
 * 폼이 옮겨도 이 칸이 먼저 재방문 규칙으로 옮겨 버린다. 그래서 이동은 이 칸 한 곳에서만 한다.
 */
export function RedirectIfAuthed() {
  const session = useQuery(sessionQueryOptions())
  const workspaces = useQuery({ ...workspaceListQueryOptions(), enabled: Boolean(session.data) })
  const [sawSignedOut, setSawSignedOut] = useState(false)
  // 조회가 끝났는데 사용자가 없으면 비로그인을 본 것이다 — 401(null)뿐 아니라 네트워크·5xx 실패도 그렇다.
  // 그 화면에서 로그인한 것은 로그인 직후다. 렌더 중 파생 상태 갱신이고 한 번 true 가 되면 되돌아가지 않는다
  if (!session.data && !session.isPending && !sawSignedOut) setSawSignedOut(true)

  if (session.data === undefined && session.isPending) return <RouteSkeleton />
  if (!session.data) return <Outlet />
  if (workspaces.data === undefined) {
    return workspaces.isError ? (
      <ScreenError error={workspaces.error} onRetry={() => void workspaces.refetch()} />
    ) : (
      <RouteSkeleton />
    )
  }
  const destination = sawSignedOut
    ? postLoginPath(workspaces.data)
    : authRevisitPath(workspaces.data, session.data.lastWorkspaceId)
  return <Navigate to={destination} replace />
}
