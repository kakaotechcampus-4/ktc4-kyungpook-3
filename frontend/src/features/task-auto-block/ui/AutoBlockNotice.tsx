import type { Task } from '@/entities/task'
import { Button } from '@/shared/ui/button'
import { useTaskAutoBlock } from '../model/useTaskAutoBlock'
import type { TaskAutoBlock } from '../model/useTaskAutoBlock'

/** 자동 막힘 표시와 PM 의 `막힘 풀기`. 자동 막힘이 아니면 아무것도 그리지 않는다 */
export function AutoBlockNotice({ autoBlock, isPm }: { autoBlock: TaskAutoBlock; isPm: boolean }) {
  if (!autoBlock.automatic) return null
  return (
    <div className="flex flex-wrap items-center gap-10">
      <p className="text-caption text-dim">리마인드에 응답이 없어 자동으로 막혔어요.</p>
      {isPm ? (
        <Button size="sm" loading={autoBlock.undoPending} onClick={autoBlock.undo}>
          막힘 풀기
        </Button>
      ) : null}
    </div>
  )
}

/** 태스크 하나의 자동 막힘 표시 */
export function TaskAutoBlockNotice({
  workspaceId,
  task,
  isPm,
}: {
  workspaceId: string
  task: Task
  isPm: boolean
}) {
  return <AutoBlockNotice autoBlock={useTaskAutoBlock(workspaceId, task)} isPm={isPm} />
}
