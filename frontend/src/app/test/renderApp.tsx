import { render } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, Routes, useLocation } from 'react-router'
import type { Location } from 'react-router'
import { onTestFinished } from 'vitest'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import type { GuardedNavigate } from '@/shared/lib/unsaved-changes'
import { App } from '../App'
import { createApp } from '../createApp'
import { appRoutes } from '../router/routes'

interface RouterProbeProps {
  onLocation: (location: Location) => void
  onNavigate: (navigate: GuardedNavigate) => void
}

/** 라우터 안에서 지금 주소를 알리고 코드 이동 함수를 넘긴다. 코드 이동은 앱과 같은 관문을 탄다 */
// 테스트 전용 파일이라 fast refresh 대상이 아니다
// eslint-disable-next-line react-refresh/only-export-components
function RouterProbe({ onLocation, onNavigate }: RouterProbeProps) {
  const location = useLocation()
  const navigate = useGuardedNavigate()
  useEffect(() => {
    onLocation(location)
  }, [location, onLocation])
  useEffect(() => {
    onNavigate(navigate)
  }, [navigate, onNavigate])
  return null
}

/**
 * 제품과 같은 배선(createApp, App, 경로 표)에 라우터만 MemoryRouter 로 바꿔 끼운다.
 * 선언형 라우터에는 밖에서 읽을 라우터 객체가 없다. 주소와 코드 이동은 RouterProbe 로 얻는다.
 */
export function renderApp(initialPath: string) {
  const app = createApp()
  onTestFinished(() => app.dispose())

  const visited: Location[] = []
  let guardedNavigate: GuardedNavigate | null = null

  const view = render(
    <App queryClient={app.queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>{appRoutes}</Routes>
        <RouterProbe
          onLocation={(location) => visited.push(location)}
          onNavigate={(next) => {
            guardedNavigate = next
          }}
        />
      </MemoryRouter>
    </App>,
  )

  return {
    ...app,
    ...view,
    /** 지금 주소 */
    location(): Location {
      const current = visited.at(-1)
      if (!current) throw new Error('router has not rendered yet')
      return current
    },
    /** 거쳐 온 주소. 같은 경로라도 이동마다 key 가 다른 항목으로 남는다 */
    visited: (): readonly Location[] => [...visited],
    /** 코드 이동. 앱의 useGuardedNavigate 와 같아서 dirty 면 모달을 연다 */
    navigate(to: string): void {
      if (!guardedNavigate) throw new Error('router has not rendered yet')
      guardedNavigate(to)
    },
  }
}
