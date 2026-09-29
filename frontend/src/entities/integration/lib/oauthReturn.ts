import { parseEnumParam } from '@/shared/lib/url'
import { readOAuthResult } from '@/shared/lib/oauth'
import type { OAuthOutcome } from '@/shared/lib/oauth'
import type { IntegrationProvider } from '../model/types'

const providers = ['discord', 'notion'] as const satisfies readonly IntegrationProvider[]

export interface IntegrationReturn {
  provider: IntegrationProvider
  outcome: OAuthOutcome
}

/**
 * OAuth 에서 돌아온 주소의 결과. 결과가 없거나 모르는 provider 면 null 이다.
 * `success` 여도 완료 근거가 아니다 — 연동 상태를 다시 조회해 `connected` 인지 본다.
 */
export function readIntegrationReturn(params: URLSearchParams): IntegrationReturn | null {
  const result = readOAuthResult(params)
  if (result === null) return null
  const provider = parseEnumParam(result.provider, providers)
  return provider === null ? null : { provider, outcome: result.outcome }
}
