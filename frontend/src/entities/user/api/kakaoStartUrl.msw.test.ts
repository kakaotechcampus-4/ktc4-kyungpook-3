import { kakaoStartUrl } from './signupCode'

// 개발 서버 + VITE_ENABLE_MSW=true 인 경우만 흉내낸다. 이 파일 안에서만 설정을 바꾼다
vi.mock('@/shared/config/env', () => ({
  config: { apiBaseUrl: '/api/v1', mswEnabled: true },
}))

it('개발·MSW 모드에서는 모의 카카오 화면으로 보내고 next 는 그대로 싣는다', () => {
  expect(kakaoStartUrl('/workspaces/ws_01')).toBe('/__mock/kakao?next=%2Fworkspaces%2Fws_01')
})
