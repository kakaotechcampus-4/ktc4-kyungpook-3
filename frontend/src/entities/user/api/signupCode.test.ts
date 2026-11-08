import { kakaoStartUrl } from './signupCode'

describe('kakaoStartUrl', () => {
  // Vitest 는 MSW 모드가 아니다(VITE_ENABLE_MSW 없음). 실 API 의 start 주소가 나와야 한다
  it('MSW 모드가 아니면 실 API 의 start 에 next 를 싣는다', () => {
    expect(kakaoStartUrl('/workspaces/ws_01')).toBe(
      '/api/v1/auth/kakao/start?next=%2Fworkspaces%2Fws_01',
    )
  })

  it('돌아갈 곳이 없으면 next 를 붙이지 않는다', () => {
    expect(kakaoStartUrl(undefined)).toBe('/api/v1/auth/kakao/start')
  })
})
