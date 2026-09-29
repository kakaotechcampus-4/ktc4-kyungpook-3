import { Skeleton } from '../skeleton'

const PAGE = 'mx-auto flex max-w-column flex-col gap-14 px-24 py-48'

/**
 * 화면 코드가 오는 동안(Suspense), 가드가 캐시를 기다리는 동안 자리를 지킨다 (D-129, D-130).
 * 뼈대마다 aria-hidden 이고 컨테이너가 aria-busy 를 진다 — M2 Skeleton 의 약속을 따른다.
 */
export function PageSkeleton() {
  return (
    <main aria-busy="true" className={PAGE}>
      <Skeleton variant="block" width={240} height={32} />
      <Skeleton lines={4} />
    </main>
  )
}
