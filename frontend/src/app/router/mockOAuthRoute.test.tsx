import { screen } from '@testing-library/react'
import { createRoutesFromElements } from 'react-router'
import type { RouteObject } from 'react-router'
import { devPaths, paths } from '@/shared/config/routes'
import { renderApp } from '../test/renderApp'
import { applyScenario } from '@/shared/mock/scenarios'
import { appRoutes } from './routes'

// 개발 서버 + VITE_ENABLE_MSW=true 를 흉내낸다. 이 파일 안에서만 설정을 바꾼다.
// 프로덕션 빌드에서는 import.meta.env.DEV 가 false 라 이 분기와 화면 chunk 가 번들에서 빠진다
vi.mock('@/shared/config/env', () => ({
  config: { apiBaseUrl: '/api/v1', mswEnabled: true },
}))

function allRoutes(routes: RouteObject[]): RouteObject[] {
  return routes.flatMap((route) => [route, ...allRoutes(route.children ?? [])])
}

describe('개발·MSW 모드의 모의 OAuth 경로', () => {
  it('가드 밖에 한 칸 등록된다', () => {
    const [root] = createRoutesFromElements(appRoutes)
    expect(
      root.children?.filter(({ path }) => path === '__mock/oauth/:workspaceId/:provider'),
    ).toHaveLength(1)
    expect(allRoutes([root]).filter(({ path }) => path?.startsWith('__mock'))).toHaveLength(2)
  })

  it('devPaths.mockOAuth 주소로 들어가면 모의 화면이 뜬다', async () => {
    const state = new URLSearchParams({ state: paths.onboardingStep('ws_01', 'connect_discord') })
    renderApp(`${devPaths.mockOAuth('ws_01', 'discord')}?${state.toString()}`)
    expect(await screen.findByRole('heading', { name: '모의 Discord 연결' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '연결 허용' })).toBeInTheDocument()
  })
})

describe('개발·MSW 모드의 모의 메일함 (#356)', () => {
  it('가드 밖에 한 칸 등록된다', () => {
    const [root] = createRoutesFromElements(appRoutes)
    expect(root.children?.filter(({ path }) => path === '__mock/mail')).toHaveLength(1)
  })

  it('보낸 재설정 메일을 최근 것부터 보이고 링크는 메일의 변경 화면 주소다', async () => {
    applyScenario('password-reset-invalid')
    renderApp(devPaths.mockMail())
    expect(await screen.findByRole('heading', { name: '모의 메일함' })).toBeInTheDocument()
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/reset-password#token=mock-reset-newer',
      '/reset-password#token=mock-reset-revoked',
    ])
  })

  it('메일이 없으면 비었다고 알린다', async () => {
    applyScenario('signed-out')
    renderApp(devPaths.mockMail())
    expect(await screen.findByText('받은 메일이 없어요.')).toBeInTheDocument()
  })
})
