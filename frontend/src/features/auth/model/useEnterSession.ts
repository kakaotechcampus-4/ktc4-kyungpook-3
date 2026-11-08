import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useSearchParams } from 'react-router'
import { SESSION_QUERY_KEY } from '@/entities/user'
import type { Session } from '@/entities/user'
import { fetchFreshWorkspaces } from '@/entities/workspace'
import { LOGIN_PARAMS, paths } from '@/shared/config/routes'
import { parseReturnPath } from '@/shared/lib/return-path'
import { preloadScreenCode } from '@/shared/lib/screen-code'
import { showSplash } from '@/shared/lib/splash'
import { clearUserScope } from '../lib/userScope'
import { clearSignOutMark } from './signOutMarker'

/**
 * 로그인 뒤 도착할 화면을 고르기 전에 그 코드를 먼저 받을 경로. 돌아갈 경로(`?next=`)가 있으면 그곳, 없으면 대시보드다.
 * 공간은 아직 모른다 — 경로 표에서 화면을 찾는 데는 경로 모양만 있으면 되어 공간 자리를 비워 둔 모양을 쓴다
 */
function entryPath(next: string | null): string {
  return parseReturnPath(next) ?? paths.dashboard(':workspaceId')
}

/**
 * 로그인·가입이 성공한 뒤의 공통 경로.
 * 이전 사용자 요청·캐시 정리 → 새 워크스페이스 목록 확보 → 세션 반영. 반영하는 순간 인증 화면의
 * `RedirectIfAuthed` 가 돌아갈 경로(`?next=`)나 `postLoginPath` 로 옮긴다 — 방금 이 화면에서 비로그인을 본 칸이라 재방문이 아니다.
 *
 * 폼은 직접 옮기지 않는다. 라우터 이동은 transition 이라 세션 캐시 갱신보다 늦게 그려지고,
 * 그 사이 가드가 재방문 규칙으로 먼저 옮긴다. 이동을 가드 한 곳에 둔다 (RedirectIfAuthed 참고).
 * 목록 확보가 실패해도 세션은 반영한다 (F-r1 #12). 서버에는 이미 세션이 있고, 가입이라면 계정도 이미 생겼다 —
 * 비로그인 화면에 남기면 다시 제출한 가입이 409 로 막힌다. 가드가 목록 오류와 다시 시도를 보인다.
 *
 * 공간 목록을 받는 동안 도착할 화면의 코드를 함께 받기 시작한다 (#539) — 세션을 반영한 뒤 화면 코드를 기다리는 뼈대가
 * 보이지 않게. 미리 받기는 덤이라 실패해도 로그인을 막지 않는다. 데이터는 여기서 받지 않는다.
 */
export function useEnterSession(): (session: Session) => Promise<void> {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const next = searchParams.get(LOGIN_PARAMS.next)

  return useCallback(
    async (session) => {
      // 로그인 직후의 공간 확인부터 도착한 화면이 그려질 때까지 스플래시가 덮는다 (#430).
      // 공간 확인은 세션 반영 전에 끝나므로 RedirectIfAuthed 가 세션을 보는 때에는 이미 늦다
      const releaseSplash = showSplash()
      try {
        preloadScreenCode(entryPath(next))
        await clearUserScope(queryClient)
        // 가드가 이 캐시를 그대로 쓴다. 세션을 반영하기 전에 받아 둬야 이동이 한 번에 끝난다
        // 실패는 목록 query 의 오류 상태로 남는다. 가드(RedirectIfAuthed)가 그것을 구독해 보인다
        await fetchFreshWorkspaces(queryClient).catch(() => undefined)
        clearSignOutMark()
        queryClient.setQueryData(SESSION_QUERY_KEY, session)
      } finally {
        releaseSplash()
      }
    },
    [queryClient, next],
  )
}
