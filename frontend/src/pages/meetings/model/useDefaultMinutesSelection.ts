import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { latestMinutesId, meetingListQueryOptions } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { useLivePathname } from '@/shared/lib/live-pathname'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'

/** 끝의 `/` 는 같은 경로로 본다 — `/meetings/` 도 기본 진입이다 */
function withoutTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

/**
 * 기본 진입(`/meetings`)에서 가장 최근 정리 끝난 회의를 골라 URL 을 `replace` 한다 (D-106, U5-1).
 * 회의가 URL 에 있으면(목록에서 고름·직접 링크·완료 토스트) 아무것도 하지 않는다 — 목록을 다시 받아도 그 회의가 남는다.
 *
 * 목록은 늦게 올 수 있다. 그 사이 사용자가 다른 곳으로 갔으면 끌고 오지 않는다 — 기록의 지금 경로(`useLivePathname`)가
 * 아직 이 공간의 회의록 목록일 때만 옮긴다. 선언형 라우터는 기록을 먼저 옮기고 화면은 transition 으로 그려서, 지연 로드 화면을
 * 기다리는 동안 이 화면은 아직 마운트돼 있다 (U4 r1 M01 과 같은 모양). 로그아웃·공간 전환도 경로가 바뀌어 같은 검사로 걸러진다.
 * 이동은 앱 안 이동의 관문(`useGuardedNavigate`)을 탄다.
 */
export function useDefaultMinutesSelection(workspaceId: string, requested: boolean): void {
  const { data: latestId } = useQuery({
    ...meetingListQueryOptions(workspaceId),
    select: latestMinutesId,
  })
  const navigate = useGuardedNavigate()
  const livePathname = useLivePathname()

  useEffect(() => {
    if (requested || latestId === undefined || latestId === null) return
    if (withoutTrailingSlash(livePathname()) !== paths.meetings(workspaceId)) return
    navigate(paths.meetings(workspaceId, latestId), { replace: true })
  }, [requested, latestId, workspaceId, navigate, livePathname])
}
