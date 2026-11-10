import type { TaskStatus } from '../model/types'

/* 8px·둥글기 2px 네모. 할 일은 1.5px 실선 `#BDBDBD` 테두리, 완료는 `#E8E8E8` 면이다 (TasksBoard). 막힘만 포인트 레드 점이다.
   `border-dashed` 는 점선 모양까지 함께 주므로 할 일은 색만 점선 토큰에서 가져온다. 2px 둥글기는 토큰에 없어 값으로 적는다 */
const MARK: Record<TaskStatus, string> = {
  todo: 'rounded-[2px] border-[1.5px] border-(--color-dashed) bg-transparent',
  in_progress: 'rounded-[2px] bg-ink-solid',
  blocked: 'rounded-999 bg-accent-point',
  done: 'rounded-[2px] bg-line',
}

/** 상태 표식. 보드 칸 머리와 상태 선택 상자가 같이 쓴다. 뜻은 옆 글자가 준다 */
export function TaskStatusMark({ status }: { status: TaskStatus }) {
  return <span aria-hidden="true" className={`h-8 w-8 shrink-0 ${MARK[status]}`} />
}
