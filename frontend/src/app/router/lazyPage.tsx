import { Suspense, lazy } from 'react'
import type { ComponentType } from 'react'
import { PageSkeleton } from '@/shared/ui/page-skeleton'

/** 주요 화면은 라우트 단위로 나눈다 (D-130). 코드가 올 때까지 M2 Skeleton 이 자리를 지킨다 */
export function lazyPage(load: () => Promise<ComponentType>) {
  const Page = lazy(async () => ({ default: await load() }))
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Page />
    </Suspense>
  )
}
