import { Icon } from '@/shared/ui/icon'
import { BACK, ROOT } from './frame'
import { TaskDetailSkeleton } from './TaskDetailSkeleton'

/**
 * 태스크 상세의 라우트 뼈대 (#510). TaskDetail 이 태스크를 기다릴 때와 같다 — `태스크 목록` 돌아가기 줄과 상세 뼈대(#508).
 * 돌아가기 줄은 누를 수 없는 자리표시다. 기다림은 main 의 aria-busy 가 알린다
 */
export function TaskDetailRouteSkeleton() {
  return (
    <main aria-busy="true" className={ROOT}>
      <span aria-hidden="true" className={BACK}>
        <Icon name="chevron-left" size={14} />
        태스크 목록
      </span>
      <div>
        <TaskDetailSkeleton />
      </div>
    </main>
  )
}
