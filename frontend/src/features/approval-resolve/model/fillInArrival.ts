import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'

/** 대시보드 `채워 넣기` 가 확인 필요 상세로 갈 때 링크에 싣는 일회성 표시 (D-176). 주소에 넣지 않는다(D-132) */
export const FILL_IN_ARRIVAL = { approvalFillIn: true } as const

function isFillInArrival(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { approvalFillIn?: unknown }).approvalFillIn === true
  )
}

/**
 * 이번 이동이 `채워 넣기` 로 왔는가. 읽은 뒤 같은 주소로 replace 해 기록의 표시를 지운다 —
 * history.state 는 새로고침에도 남아서, 지우지 않으면 새로고침·뒤로/앞으로 가기로 다시 와도 빈 칸으로 포커스가 간다.
 * 지운 뒤에는 false 다. 받는 쪽이 처음 그릴 때 붙잡아야 한다(ApprovalReview).
 * 이 훅이 값을 붙잡지 않는 것은 페이지가 승인을 바꿔도 다시 마운트되지 않아서다 — 붙잡으면 다음 승인도 열린다
 */
export function useFillInArrival(): boolean {
  const location = useLocation()
  const { pathname, search, hash } = location
  const navigate = useGuardedNavigate()
  const arrived = isFillInArrival(location.state)
  useEffect(() => {
    // 경로가 같아 이탈 확인을 묻지 않는다
    if (arrived) navigate({ pathname, search, hash }, { replace: true, state: null })
  }, [arrived, navigate, pathname, search, hash])
  return arrived
}
