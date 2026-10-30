import { screen } from '@testing-library/react'
import { paths } from '@/shared/config/routes'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { renderApp } from './test/renderApp'

/*
 * M8 메시지 (계획 C-6 1~6단계, AC-01 ~ AC-07). 개발 서버 + VITE_ENABLE_MSW=true 를 흉내낸다 — 이 파일 안에서만 설정을 바꾼다.
 * 실 API 모드의 준비 중 안내는 라우트·가드·앱 셸 테스트가 그대로 본다 (AC-01)
 */
vi.mock('@/shared/config/env', () => ({
  config: { apiBaseUrl: '/api/v1', mswEnabled: true },
}))

vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('MSW 모드에서만 새 화면이다 (AC-01)', () => {
  it.each([
    paths.messages('ws_01'),
    paths.messageThread('ws_01', 'th_01'),
    `${paths.messages('ws_01')}/nope`,
  ])('%s 는 준비 중 안내 대신 메시지 화면이다', async (path) => {
    renderApp(path)
    expect(await screen.findByRole('heading', { level: 1, name: '메시지' })).toBeInTheDocument()
    expect(screen.queryByText('메시지는 준비 중이에요')).toBeNull()
  })
})
