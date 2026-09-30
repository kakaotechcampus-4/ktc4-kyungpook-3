import { safeReturnPath, withOAuthResult } from '@/shared/lib/oauth'
import type { OAuthOutcome } from '@/shared/lib/oauth'
import { requireMember } from '../auth-guard'
import { db } from '../db'
import { MOCK_NOW } from '../fixtures/constants'
import { saveDb } from '../persistence'

export type MockOAuthProvider = 'discord' | 'notion'

export const MOCK_OAUTH_PROVIDERS = [
  'discord',
  'notion',
] as const satisfies readonly MockOAuthProvider[]

const PROVIDER_NAME: Record<MockOAuthProvider, string> = { discord: 'Discord', notion: 'Notion' }

export function mockOAuthProviderName(provider: MockOAuthProvider): string {
  return PROVIDER_NAME[provider]
}

/** 로그인 여부나 복귀 경로가 틀려 돌아갈 곳이 없을 때. 가드가 알맞은 곳으로 다시 보낸다 */
const FALLBACK_PATH = '/'

export interface MockOAuthRequest {
  workspaceId: string
  provider: MockOAuthProvider
  /** 시작 주소의 `state`. 앱 안 경로만 받는다 */
  state: string | null
  /** 모의 화면에서 누른 결과 */
  outcome: OAuthOutcome
}

/**
 * 실 API 콜백(`/workspaces/{id}/integrations/{provider}/callback`)이 할 일을 흉내낸다.
 * 성공이면 연동 행을 `connected` 로 만든다. 로그인·소속이 없거나 공간이 없으면 실패로 돌아간다.
 * `display_name` 은 실 API 처럼 생성 문자열이다 (계약 §4.0-②-7).
 */
export function settleMockOAuth({
  workspaceId,
  provider,
  outcome,
}: Omit<MockOAuthRequest, 'state'>): OAuthOutcome {
  if (outcome !== 'success') return outcome
  const integrations = db.integrations[workspaceId]
  if (requireMember(workspaceId) !== null || integrations === undefined) return 'failed'
  integrations[provider] = {
    status: 'connected',
    display_name: `${PROVIDER_NAME[provider]} 연결됨`,
    connected_at: MOCK_NOW,
  }
  return 'success'
}

/**
 * 결과를 반영하고 sessionStorage 에 쓴 뒤 돌아갈 주소를 돌려준다.
 * 곧 현재 탭을 옮기므로 다음 응답을 기다리지 않고 여기서 저장한다.
 */
export function finishMockOAuth(request: MockOAuthRequest, storage: Storage): string {
  const outcome = settleMockOAuth(request)
  saveDb(storage)
  const returnPath = safeReturnPath(request.state)
  return returnPath === null
    ? FALLBACK_PATH
    : withOAuthResult(returnPath, request.provider, outcome)
}
