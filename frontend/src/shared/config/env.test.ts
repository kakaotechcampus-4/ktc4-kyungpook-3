import { DEFAULT_API_BASE_URL, readConfig } from './env'

describe('readConfig', () => {
  it('API 주소가 비었거나 없으면 동일 출처 /api/v1 이다', () => {
    expect(readConfig({ VITE_API_BASE_URL: '' }, true).apiBaseUrl).toBe(DEFAULT_API_BASE_URL)
    expect(readConfig({}, true).apiBaseUrl).toBe('/api/v1')
  })

  it('준 주소는 끝 슬래시만 떼고 그대로 쓴다', () => {
    expect(
      readConfig({ VITE_API_BASE_URL: 'https://api.example.com/api/v1/' }, false).apiBaseUrl,
    ).toBe('https://api.example.com/api/v1')
    expect(readConfig({ VITE_API_BASE_URL: '/proxy/api/v1' }, false).apiBaseUrl).toBe(
      '/proxy/api/v1',
    )
  })

  it('주소 모양이 아니면 앱을 띄우지 않는다', () => {
    expect(() => readConfig({ VITE_API_BASE_URL: 'api.example.com' }, true)).toThrow('환경 변수')
  })

  it('MSW 는 개발 서버에서 true 일 때만 켠다', () => {
    expect(readConfig({ VITE_ENABLE_MSW: 'true' }, true).mswEnabled).toBe(true)
    expect(readConfig({ VITE_ENABLE_MSW: 'true' }, false).mswEnabled).toBe(false)
    expect(readConfig({ VITE_ENABLE_MSW: 'false' }, true).mswEnabled).toBe(false)
    expect(readConfig({}, true).mswEnabled).toBe(false)
  })

  it('MSW 값이 true·false 가 아니면 거절한다', () => {
    expect(() => readConfig({ VITE_ENABLE_MSW: 'yes' }, true)).toThrow('환경 변수')
  })
})
