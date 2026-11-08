import { Suspense, lazy } from 'react'
import type { ComponentType } from 'react'
import { RouteSkeleton } from './RouteSkeleton'
import { registerScreenCode } from './screenCode'

/**
 * 주요 화면은 라우트 단위로 나눈다 (D-130). 코드가 올 때까지 M2 Skeleton 이 자리를 지킨다.
 * 코드 부르기는 한 번으로 묶어 미리 부르기(`screenCode`)와 같은 요청을 쓴다 — 탭에 다가갈 때·한가할 때·로그인 중에 먼저
 * 받아 두면 화면을 열 때 기다리지 않는다 (#536, #539). 실패하면 묶음을 풀어 다음 부름이 다시 받는다
 */
export function lazyPage(load: () => Promise<ComponentType>) {
  let pending: Promise<ComponentType> | null = null
  const once = () => {
    pending ??= load().catch((error: unknown) => {
      pending = null
      throw error
    })
    return pending
  }
  const Page = lazy(async () => ({ default: await once() }))
  const page = (
    <Suspense fallback={<RouteSkeleton />}>
      <Page />
    </Suspense>
  )
  registerScreenCode(page, once)
  return page
}
