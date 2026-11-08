import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { withoutOAuthResult } from '@/shared/lib/oauth'
import { isKakaoReturn, readKakaoNotice } from './kakaoLogin'
import type { LoginNotice } from './kakaoLogin'
import { readLoginNotice } from './passwordReset'

function firstNotice(state: unknown, search: string): LoginNotice {
  const passwordChanged = readLoginNotice(state)
  return passwordChanged === null
    ? readKakaoNotice(new URLSearchParams(search))
    : { status: passwordChanged, error: null }
}

/**
 * 로그인 화면에 한 번만 띄우는 안내(비밀번호를 바꾸고 온 경우, 카카오에서 돌아온 경우). 이동 state 와 복귀 주소는
 * 기록 항목에 남아 새로고침·뒤로가기에도 다시 읽히므로, 처음 읽은 값을 상태로 잡고 그 항목에서 replace 로 지운다.
 * `next` 는 남긴다. 지운 뒤에도 화면에는 그대로 보인다.
 */
export function useLoginNotice(): LoginNotice {
  const location = useLocation()
  const navigate = useNavigate()
  const [notice] = useState(() => firstNotice(location.state, location.search))
  const params = new URLSearchParams(location.search)
  const kakaoReturn = isKakaoReturn(params)
  const pending = readLoginNotice(location.state) !== null || kakaoReturn
  const search = kakaoReturn ? withoutOAuthResult(params) : location.search

  useEffect(() => {
    if (!pending) return
    void navigate({ pathname: location.pathname, search }, { replace: true, state: null })
  }, [pending, location.pathname, search, navigate])

  return notice
}
