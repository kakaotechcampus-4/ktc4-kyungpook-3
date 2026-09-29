/*
 * OAuth 복귀 주소의 모양. 연동 시작은 현재 탭 이동이고 `state` 에 복귀 경로를 담는다 (D-158).
 * 콜백은 그 경로에 결과를 붙여 돌려보낸다. 실 API 의 콜백은 아직 없어서(계약 §4.3) 이 모양은 프론트엔드 가정이다.
 * 모의 OAuth 화면(shared/mock)과 복귀를 읽는 entities 가 같은 이름을 쓰도록 여기 한 곳에 둔다.
 */

export const OAUTH_OUTCOMES = ['success', 'cancelled', 'failed'] as const
export type OAuthOutcome = (typeof OAUTH_OUTCOMES)[number]

export const OAUTH_RETURN_PARAMS = { provider: 'oauth', outcome: 'oauth_result' } as const

/** 복귀 주소를 만들 때 쓰는 가짜 origin. 경로·검색·해시만 꺼낸다 */
const BASE = 'http://return.invalid'

/**
 * `state` 는 앱 안 경로만 받는다. 외부 주소(`https://…`, `//host`)로 보내는 열린 리다이렉트를 막는다.
 * 쓸 수 없으면 null
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\'))
    return null
  const url = new URL(value, BASE)
  return url.origin === BASE ? `${url.pathname}${url.search}${url.hash}` : null
}

/** 복귀 경로에 결과를 붙인다. 경로에 이미 있던 검색 파라미터는 남긴다 */
export function withOAuthResult(path: string, provider: string, outcome: OAuthOutcome): string {
  const url = new URL(path, BASE)
  url.searchParams.set(OAUTH_RETURN_PARAMS.provider, provider)
  url.searchParams.set(OAUTH_RETURN_PARAMS.outcome, outcome)
  return `${url.pathname}${url.search}${url.hash}`
}

/** 복귀 주소에서 결과를 읽는다. 둘 중 하나라도 없거나 모르는 결과면 null */
export function readOAuthResult(
  params: URLSearchParams,
): { provider: string; outcome: OAuthOutcome } | null {
  const provider = params.get(OAUTH_RETURN_PARAMS.provider)
  const outcome = params.get(OAUTH_RETURN_PARAMS.outcome)
  if (!provider || !(OAUTH_OUTCOMES as readonly (string | null)[]).includes(outcome)) return null
  return { provider, outcome: outcome as OAuthOutcome }
}

/** 복귀 결과만 뺀 검색 문자열(`?review=1` 등 나머지는 남긴다). 남는 것이 없으면 '' */
export function withoutOAuthResult(params: URLSearchParams): string {
  const rest = new URLSearchParams(params)
  rest.delete(OAUTH_RETURN_PARAMS.provider)
  rest.delete(OAUTH_RETURN_PARAMS.outcome)
  const search = rest.toString()
  return search === '' ? '' : `?${search}`
}
