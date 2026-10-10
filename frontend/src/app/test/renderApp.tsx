import { render, waitFor } from '@testing-library/react'
import { StrictMode, useEffect, useLayoutEffect } from 'react'
import { MemoryRouter, Routes, useLocation, useNavigationType } from 'react-router'
import type { Location, NavigationType } from 'react-router'
import { expect, onTestFinished } from 'vitest'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import type { GuardedNavigate } from '@/shared/lib/unsaved-changes'
import { App } from '../App'
import { createApp } from '../createApp'
import { appRoutes } from '../router/routes'

/* 지연 로드 화면을 이 헬퍼가 로드될 때 미리 읽는다. 앱에서는 경로마다 lazy 로 나뉘지만, 테스트에서는 파일의 첫 테스트가
   그 모듈을 처음 변환하느라 전체 실행 부하에서 대기 한도(3초)를 넘길 때가 있었다 — 스켈레톤만 보이다 끝난다.
   변환 비용을 테스트 시간 밖(파일 로드)으로 옮긴다. lazy 가 돌려주는 모듈은 같아서 동작은 그대로다 */
import.meta.glob('../../pages/*/index.ts', { eager: true })

interface RouterProbeProps {
  onLocation: (location: Location, action: NavigationType) => void
  onNavigate: (navigate: GuardedNavigate) => void
}

/**
 * 라우터 안에서 지금 주소를 알리고 코드 이동 함수를 넘긴다. 코드 이동은 앱과 같은 관문을 탄다.
 *
 * 주소는 **layout effect** 로 적는다. 라우터 이동은 transition 이라 그 커밋의 일반 effect 는 늦게 비워질 수 있다 —
 * 화면(DOM)은 이미 바뀌었는데 적힌 주소가 한 틱 늦어, 화면을 기다린 뒤 주소를 읽는 테스트가 부하 때 가끔 틀렸다.
 * layout effect 는 DOM 을 바꾼 바로 그 커밋 안에서 동기로 돈다. 화면이 보이면 주소도 이미 적혀 있다.
 */
// 테스트 전용 파일이라 fast refresh 대상이 아니다
// eslint-disable-next-line react-refresh/only-export-components
function RouterProbe({ onLocation, onNavigate }: RouterProbeProps) {
  const location = useLocation()
  const action = useNavigationType()
  const navigate = useGuardedNavigate()
  useLayoutEffect(() => {
    onLocation(location, action)
  }, [location, action, onLocation])
  useEffect(() => {
    onNavigate(navigate)
  }, [navigate, onNavigate])
  return null
}

/**
 * 제품과 같은 배선(createApp, App, 경로 표)에 라우터만 MemoryRouter 로 바꿔 끼운다.
 * 선언형 라우터에는 밖에서 읽을 라우터 객체가 없다. 주소와 코드 이동은 RouterProbe 로 얻는다.
 */
export interface RenderAppOptions {
  /** 브라우저(main.tsx)처럼 StrictMode 로 감싼다. 효과가 두 번 돌고 구독이 한 번 끊겼다 다시 붙는다 */
  strict?: boolean
}

export function renderApp(initialPath: string, options: RenderAppOptions = {}) {
  const app = createApp()
  onTestFinished(() => app.dispose())

  const visited: Location[] = []
  /** visited 와 같은 순서로, 그 항목에 닿은 방식(PUSH·REPLACE·POP) */
  const actions: NavigationType[] = []
  let guardedNavigate: GuardedNavigate | null = null

  const tree = (
    <App queryClient={app.queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>{appRoutes}</Routes>
        <RouterProbe
          onLocation={(location, action) => {
            // StrictMode 는 마운트 때 효과를 두 번 돌린다. 같은 기록 항목(key)을 두 번 적지 않는다
            if (visited.at(-1)?.key === location.key) return
            visited.push(location)
            actions.push(action)
          }}
          onNavigate={(next) => {
            guardedNavigate = next
          }}
        />
      </MemoryRouter>
    </App>
  )
  const view = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree)

  const current = (): Location => {
    const latest = visited.at(-1)
    if (!latest) throw new Error('router has not rendered yet')
    return latest
  }

  return {
    ...app,
    ...view,
    /*
     * 주소는 기다려서 확인한다 — 동기로 꺼내 읽는 접근자를 두지 않는다.
     * 기록은 커밋과 같이 가지만(layout effect), 이동 직후 곧바로 확인하는 곳도 한 가지 방식으로 안전하게 한다.
     * 최종 주소만 기다린다. "중간에 다른 곳을 거치지 않았다"는 `visited()` 로 따로 단언한다.
     */
    /** 지금 경로가 pathname 이 될 때까지 기다린다 (waitFor 기본 1초) */
    async expectPath(pathname: string): Promise<void> {
      await waitFor(() => expect(current().pathname).toBe(pathname))
    },
    /** 지금 검색 문자열이 search 가 될 때까지 기다린다. 비었으면 '' */
    async expectSearch(search: string): Promise<void> {
      await waitFor(() => expect(current().search).toBe(search))
    },
    /** 거쳐 온 주소. 같은 경로라도 이동마다 key 가 다른 항목으로 남는다 */
    visited: (): readonly Location[] => [...visited],
    /** `visited` 의 각 항목에 닿은 방식. 첫 항목은 POP 이다. `replace` 이동이면 REPLACE */
    visitedActions: (): readonly NavigationType[] => [...actions],
    /** 코드 이동. 앱의 useGuardedNavigate 와 같아서 dirty 면 모달을 연다 */
    navigate(to: string): void {
      if (!guardedNavigate) throw new Error('router has not rendered yet')
      guardedNavigate(to)
    },
  }
}
