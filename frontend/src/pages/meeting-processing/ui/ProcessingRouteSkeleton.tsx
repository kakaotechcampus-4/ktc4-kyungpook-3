import { Skeleton } from '@/shared/ui/skeleton'
import { COLUMN, PAGE } from './styles'

/** 회의 처리의 라우트 뼈대 (#510). 화면이 정리 상태를 기다릴 때(Loading)와 같은 네 줄이다. 기다림은 main 의 aria-busy 가 알린다 */
export function ProcessingRouteSkeleton() {
  return (
    <main aria-busy="true" className={PAGE}>
      <div className={COLUMN}>
        <div aria-hidden="true">
          <Skeleton lines={4} />
        </div>
      </div>
    </main>
  )
}
