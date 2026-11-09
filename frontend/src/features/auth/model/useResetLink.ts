import { skipToken, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { resetLinkProblem, verifyPasswordReset } from '@/entities/user'
import type { ResetLinkProblem } from '@/entities/user'
import { readResetToken } from './passwordReset'

/**
 * 메일 링크로 연 변경 화면의 상태.
 * - `checking`: 링크를 확인하는 중
 * - `ready`: 새 비밀번호를 받을 수 있다
 * - `rejected`: 링크를 쓸 수 없다. 새 링크를 받아야 한다
 * - `failed`: 확인 요청이 실패했다(네트워크·서버). 같은 링크로 다시 확인할 수 있다
 */
export type ResetLink =
  | { status: 'checking' }
  | { status: 'ready'; token: string; emailMasked: string }
  | { status: 'rejected'; problem: ResetLinkProblem }
  | { status: 'failed'; error: unknown; retry: () => void }

/** 링크 확인 결과의 Query key 앞부분. 뒤에 연 링크마다 다른 번호가 붙는다 — 토큰은 넣지 않는다 */
export const RESET_LINK_QUERY_KEY = ['password-reset-link'] as const

export interface ResetLinkControl {
  link: ResetLink
  /** 변경 요청이 링크를 쓸 수 없다고 답했을 때 부른다. 그 사이 다른 링크를 열었으면 무시한다 */
  reject: (problem: ResetLinkProblem) => void
}

/** 화면이 연 메일 링크 하나. `key` 는 그 링크를 실어 온 기록 항목이다 */
interface OpenedLink {
  id: number
  key: string
  token: string | null
  problem: ResetLinkProblem | null
}

let lastLinkId = 0

function openLink(key: string, token: string | null): OpenedLink {
  lastLinkId += 1
  return { id: lastLinkId, key, token, problem: null }
}

/**
 * 주소의 `#token=` 을 읽어 링크를 확인한다 (계약 §4.1.1).
 * 토큰은 주소에서 읽어 상태로 둔다. 확인 요청 전에 주소에서 fragment 를 replace 로 지우고,
 * 확인은 주소가 비워진 뒤에야 시작한다 — 토큰이 기록과 화면 주소에 남지 않고 요청 본문으로만 나간다.
 * StrictMode 가 효과를 다시 돌려도 상태의 토큰은 그대로라 잃지 않는다.
 * 같은 화면에 새 기록 항목으로 `#token=` 이 다시 오면(새 메일 링크) 토큰·확인 결과·변경 거절을 모두 새 링크의 것으로 바꾼다.
 * 확인 결과는 링크마다 다른 Query 다. 앞 링크의 확인이 아직 오는 중이면 그 Query 를 떠나며 요청을 취소한다.
 * 토큰은 Query key 에 넣지 않는다 — key 와 그 hash 는 공용 캐시의 식별자로 남는다. 화면을 떠나면 확인 결과도 바로 버린다.
 */
export function useResetLink(): ResetLinkControl {
  const location = useLocation()
  const navigate = useNavigate()
  const [opened, setOpened] = useState(() => openLink(location.key, readResetToken(location.hash)))
  const incoming = location.key === opened.key ? null : readResetToken(location.hash)
  if (incoming !== null) setOpened(openLink(location.key, incoming))
  const addressClean = location.hash === ''

  useEffect(() => {
    if (addressClean) return
    void navigate({ pathname: location.pathname, search: location.search }, { replace: true })
  }, [addressClean, location.pathname, location.search, navigate])

  const { id, token, problem: confirmProblem } = opened
  const verify = useQuery({
    queryKey: [...RESET_LINK_QUERY_KEY, id],
    queryFn:
      token !== null && addressClean
        ? ({ signal }) => verifyPasswordReset(token, signal)
        : skipToken,
    // 토큰은 한 번 쓰면 끝이다. 창 포커스로 다시 확인하지 않는다 — 입력하는 사이 화면이 바뀌지 않는다
    staleTime: Infinity,
    gcTime: 0,
  })

  const reject = useCallback(
    (problem: ResetLinkProblem) =>
      setOpened((current) => (current.id === id ? { ...current, problem } : current)),
    [id],
  )

  let link: ResetLink
  if (token === null) link = { status: 'rejected', problem: 'invalid' }
  else if (confirmProblem !== null) link = { status: 'rejected', problem: confirmProblem }
  else if (verify.isSuccess) link = { status: 'ready', token, emailMasked: verify.data.emailMasked }
  else if (verify.isError && !verify.isFetching) {
    const problem = resetLinkProblem(verify.error)
    link =
      problem === null
        ? { status: 'failed', error: verify.error, retry: () => void verify.refetch() }
        : { status: 'rejected', problem }
  } else link = { status: 'checking' }

  return { link, reject }
}
