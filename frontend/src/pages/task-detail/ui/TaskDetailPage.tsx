import { useMemberWorkspace } from '@/entities/workspace'
import { useRouteId } from '@/shared/lib/url'
import { TaskDetail, UnavailableTask } from '@/widgets/task-detail'

const ROOT = 'mx-auto flex w-full max-w-[960px] flex-col gap-24 px-36 pt-32 pb-56'

/**
 * `/workspaces/:workspaceId/tasks/:taskId` — 태스크 상세 (M6 §3-5). 라우트 조립만 한다.
 * 태스크 ID 모양이 틀리면 API 를 부르지 않고 볼 수 없다고 알린다. 태스크가 바뀌면 화면 상태를 새로 시작한다
 */
export function TaskDetailPage() {
  const workspaceId = useRouteId('workspaceId')
  const taskId = useRouteId('taskId')
  const workspace = useMemberWorkspace(workspaceId)
  if (workspaceId === null || workspace === null) return null
  if (taskId === null)
    return (
      <main className={ROOT}>
        <h1 className="text-caption font-semibold text-dim">태스크</h1>
        <UnavailableTask workspaceId={workspaceId} />
      </main>
    )
  return (
    <TaskDetail
      key={taskId}
      workspaceId={workspaceId}
      taskId={taskId}
      isPm={workspace.role === 'pm'}
    />
  )
}
