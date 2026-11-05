import { skipToken, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
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

export interface ResetLinkControl {
  link: ResetLink
  /** 변경 요청이 링크를 쓸 수 없다고 답했을 때 부른다 */
  reject: (problem: ResetLinkProblem) => void
}

/**
 * 주소의 `#token=` 을 읽어 링크를 확인한다 (계약 §4.1.1).
 * 토큰은 첫 렌더의 주소에서 한 번 읽어 상태로 둔다. 확인 요청 전에 주소에서 fragment 를 replace 로 지우고,
 * 확인은 주소가 비워진 뒤에야 시작한다 — 토큰이 기록과 화면 주소에 남지 않고 요청 본문으로만 나간다.
 * StrictMode 가 효과를 다시 돌려도 상태의 토큰은 그대로라 잃지 않는다.
 */
export function useResetLink(): ResetLinkControl {
  const location = useLocation()
  const navigate = useNavigate()
  const [token] = useState(() => readResetToken(location.hash))
  const [confirmProblem, setConfirmProblem] = useState<ResetLinkProblem | null>(null)
  const addressClean = location.hash === ''

  useEffect(() => {
    if (addressClean) return
    void navigate({ pathname: location.pathname, search: location.search }, { replace: true })
  }, [addressClean, location.pathname, location.search, navigate])

  const verify = useQuery({
    queryKey: ['password-reset-link', token],
    queryFn: token !== null && addressClean ? () => verifyPasswordReset(token) : skipToken,
    // 토큰은 한 번 쓰면 끝이다. 창 포커스로 다시 확인하지 않는다 — 입력하는 사이 화면이 바뀌지 않는다
    staleTime: Infinity,
  })

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

  return { link, reject: setConfirmProblem }
}
