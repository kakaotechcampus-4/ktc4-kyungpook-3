import { Skeleton } from '@/shared/ui/skeleton'
import { ASSIGN_TITLE, COLUMN, PAGE, TITLE } from './styles'

/** 화자 지정의 라우트 뼈대 (#510). 화면이 회의를 기다릴 때와 같은 제목과 네 줄이다. 기다림은 main 의 aria-busy 가 알린다 */
export function SpeakersRouteSkeleton() {
  return (
    <main aria-busy="true" className={PAGE}>
      <div aria-hidden="true" className={COLUMN}>
        <h1 className={TITLE}>{ASSIGN_TITLE}</h1>
        <div>
          <Skeleton lines={4} />
        </div>
      </div>
    </main>
  )
}
