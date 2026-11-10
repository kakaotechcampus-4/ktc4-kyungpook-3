import { readOAuthResult } from '@/shared/lib/oauth'
import type { OAuthOutcome } from '@/shared/lib/oauth'

const PROVIDER = 'kakao'

/** 로그인 화면이 한 번 띄우는 안내. `status` 는 조용한 안내, `error` 는 폼 상단 오류다 */
export interface LoginNotice {
  status: string | null
  error: string | null
}

const NO_NOTICE: LoginNotice = { status: null, error: null }

const FAILED = '카카오 로그인에 실패했어요. 다시 시도해 주세요.'

const CANCELLED = '카카오 로그인을 취소했어요.'

function kakaoOutcome(params: URLSearchParams): OAuthOutcome | null {
  const result = readOAuthResult(params)
  return result?.provider === PROVIDER ? result.outcome : null
}

/** 주소에 카카오 복귀 결과가 있다. 연동(Discord·Notion) 복귀는 온보딩·설정이 읽는다 */
export function isKakaoReturn(params: URLSearchParams): boolean {
  return kakaoOutcome(params) !== null
}

/** 세션을 받아 돌아왔다. 로그인 화면이 아니라 가드가 이 표시를 본다 */
export function returnedFromKakaoLogin(params: URLSearchParams): boolean {
  return kakaoOutcome(params) === 'success'
}

/** 복귀 결과의 안내. 문구는 여기서만 고르고 주소의 값을 그대로 화면에 싣지 않는다 */
export function readKakaoNotice(params: URLSearchParams): LoginNotice {
  switch (kakaoOutcome(params)) {
    case 'cancelled':
      return { status: CANCELLED, error: null }
    case 'failed':
      return { status: null, error: FAILED }
    default:
      return NO_NOTICE
  }
}
