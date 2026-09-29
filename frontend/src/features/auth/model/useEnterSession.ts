import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { SESSION_QUERY_KEY } from '@/entities/user'
import type { Session } from '@/entities/user'
import { clearUserScope, fetchFreshWorkspaces } from '../lib/userScope'

/**
 * 로그인·가입이 성공한 뒤의 공통 경로.
 * 이전 사용자 요청·캐시 정리 → 새 워크스페이스 목록 확보 → 세션 반영. 반영하는 순간 인증 화면의
 * `RedirectIfAuthed` 가 `postLoginPath` 로 옮긴다 — 방금 이 화면에서 비로그인을 본 칸이라 재방문이 아니다.
 *
 * 폼은 직접 옮기지 않는다. 라우터 이동은 transition 이라 세션 캐시 갱신보다 늦게 그려지고,
 * 그 사이 가드가 재방문 규칙으로 먼저 옮긴다. 이동을 가드 한 곳에 둔다 (RedirectIfAuthed 참고).
 * 목록 확보가 실패해도 세션은 반영한다 (F-r1 #12). 서버에는 이미 세션이 있고, 가입이라면 계정도 이미 생겼다 —
 * 비로그인 화면에 남기면 다시 제출한 가입이 409 로 막힌다. 가드가 목록 오류와 다시 시도를 보인다.
 */
export function useEnterSession(): (session: Session) => Promise<void> {
  const queryClient = useQueryClient()

  return useCallback(
    async (session) => {
      await clearUserScope(queryClient)
      // 가드가 이 캐시를 그대로 쓴다. 세션을 반영하기 전에 받아 둬야 이동이 한 번에 끝난다
      // 실패는 목록 query 의 오류 상태로 남는다. 가드(RedirectIfAuthed)가 그것을 구독해 보인다
      await fetchFreshWorkspaces(queryClient).catch(() => undefined)
      queryClient.setQueryData(SESSION_QUERY_KEY, session)
    },
    [queryClient],
  )
}
