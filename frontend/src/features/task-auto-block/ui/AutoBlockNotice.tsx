import type { Task } from '@/entities/task'
import { Button } from '@/shared/ui/button'
import { useTaskAutoBlock } from '../model/useTaskAutoBlock'
import type { TaskAutoBlock } from '../model/useTaskAutoBlock'

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
