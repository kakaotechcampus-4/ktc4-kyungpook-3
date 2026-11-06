import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { readLoginNotice } from './passwordReset'

/**
 * 로그인 화면에 한 번만 띄우는 안내(비밀번호를 바꾸고 온 경우). 이동 state 는 기록 항목에 남아 새로고침·뒤로가기에도
 * 다시 읽히므로, 처음 읽은 값을 상태로 잡고 그 항목의 state 를 replace 로 지운다. 지운 뒤에도 화면에는 그대로 보인다.
 */
export function useLoginNotice(): string | null {
  const location = useLocation()
  const navigate = useNavigate()
  const [notice] = useState(() => readLoginNotice(location.state))
  const pending = readLoginNotice(location.state) !== null

  useEffect(() => {
    if (!pending) return
    void navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: null },
    )
  }, [pending, location.pathname, location.search, navigate])

  return notice
}
