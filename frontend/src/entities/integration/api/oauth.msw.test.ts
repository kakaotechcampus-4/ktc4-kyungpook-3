import { paths } from '@/shared/config/routes'
import { integrationStartUrl } from './oauth'

// 개발 서버 + VITE_ENABLE_MSW=true 인 경우만 흉내낸다. 이 파일 안에서만 설정을 바꾼다
vi.mock('@/shared/config/env', () => ({
  config: { apiBaseUrl: '/api/v1', mswEnabled: true },
}))

it('개발·MSW 모드에서는 모의 OAuth 화면으로 보내고 state 는 그대로 싣는다', () => {
  const returnPath = paths.onboardingStep('ws_03', 'connect_notion')
  const url = new URL(integrationStartUrl('ws_03', 'notion', returnPath), location.origin)
  expect(url.pathname).toBe('/__mock/oauth/ws_03/notion')
  expect(url.searchParams.get('state')).toBe(returnPath)
})
