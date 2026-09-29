import { config } from '@/shared/config/env'
import { devPaths } from '@/shared/config/routes'
import type { IntegrationProvider } from '../model/types'

/**
 * 연동을 시작하는 주소. 현재 탭을 이 주소로 옮기고(D-158) 콜백이 `state` 의 경로로 돌려보낸다.
 * 실 API 에는 아직 `start` 가 없다(계약 §4.3). 개발·MSW 모드에서는 모의 OAuth 화면으로 보낸다.
 * `returnPath` 는 앱 안 경로다 — `paths.onboardingStep(...)` 처럼 만든다.
 */
export function integrationStartUrl(
  workspaceId: string,
  provider: IntegrationProvider,
  returnPath: string,
): string {
  const query = new URLSearchParams({ state: returnPath }).toString()
  // DEV 를 먼저 본다 — 번들러가 이 분기를 지워야 프로덕션 번들에 모의 경로가 남지 않는다
  if (import.meta.env.DEV && config.mswEnabled)
    return `${devPaths.mockOAuth(workspaceId, provider)}?${query}`
  return `${config.apiBaseUrl}/workspaces/${encodeURIComponent(workspaceId)}/integrations/${provider}/start?${query}`
}
