import { useCallback, useContext, useLayoutEffect, useRef } from 'react'
import { UNSAFE_NavigationContext, useLocation } from 'react-router'

/**
 * 사용자가 지금 가 있는 경로를 **부른 순간** 읽는 함수를 돌려준다. 늦게 끝난 비동기 작업이 「아직 이 화면에 있나」를 물을 때 쓴다.
 *
 * `useLocation` 은 그려진(커밋된) 경로다. 선언형 라우터(BrowserRouter·MemoryRouter)는 기록(history)을 먼저 옮기고
 * 화면 갱신은 transition 으로 그린다. 지연 로드 화면·Suspense 를 기다리는 동안에는 기록은 이미 새 경로인데
 * `useLocation` 과 그 값을 담은 ref 는 이전 경로다 — 그 틈에 끝난 작업이 이전 화면 기준으로 사용자를 옮기면
 * 사용자가 이미 고른 이동을 덮어쓴다 (U4 r1 M01).
 *
 * 그래서 라우터의 기록 객체가 가진 지금 위치를 직접 읽는다. 이 앱은 data router 를 쓰지 않아 `useNavigation` 이 없고,
 * 기록 객체는 구독자를 하나만 받아(라우터 자신) `listen` 할 수도 없다. 두 라우터의 navigator 는 기록 객체 그 자체이고
 * `location` getter 가 지금 값을 준다(react-router 7 의 createBrowserHistory·createMemoryHistory).
 * navigator 에 `location` 이 없는 라우터라면 커밋된 경로로 물러난다. basename 은 쓰지 않는다 — 두 값이 같은 모양이다.
 *
 * **라우터 내부에 기대는 범위.** `UNSAFE_NavigationContext` 의 `navigator` 를 읽고, 공개 `Navigator` 타입에 **없는**
 * `location` 을 `Reflect.get` 으로 꺼낸다. 공개 타입은 `createHref`·`go`·`push`·`replace` 만 약속한다 — 「navigator 가 기록 객체
 * 그 자체이고 `location` getter 가 지금 위치를 준다」는 react-router 7.18.4(lock 고정)의 구현 사실이다. 렌더 값으로 쓰지 않고
 * 늦은 부작용 직전에만 읽어 렌더 중 기록 읽기의 tearing 문제는 피한다. 물러나기는 crash 를 막을 뿐 M01 보호는 아니다 —
 * data router·custom Router·basename 을 들이면 경합이 조용히 돌아온다.
 * react-router 를 올리거나 라우터 구성을 바꿀 때 확인할 테스트: `shared/lib/live-pathname/useLivePathname.test.tsx` 전부
 * (MemoryRouter·BrowserRouter 의 지연 로드 이동, 물러나기), `app/lateAsyncRaces.test.tsx` 의
 * `진행 중인 사용자 이동을 정리 결과가 덮어쓰지 않는다 (U4 r1 M01)` 묶음과 `Notion 복귀 확인 중 팀 화면으로 가는 중…`·
 * `보내는 중 이탈 확인에서 나가기를 고른 이동이…`. 자세한 근거는 docs/impl-decision/2026-10-03-processing-tracker.md
 */
export function useLivePathname(): () => string {
  const { navigator } = useContext(UNSAFE_NavigationContext)
  const { pathname } = useLocation()
  const committed = useRef(pathname)
  useLayoutEffect(() => {
    committed.current = pathname
  }, [pathname])

  return useCallback(() => {
    const live: unknown = Reflect.get(navigator, 'location')
    if (typeof live === 'object' && live !== null && 'pathname' in live) {
      const { pathname: current } = live
      if (typeof current === 'string') return current
    }
    return committed.current
  }, [navigator])
}
