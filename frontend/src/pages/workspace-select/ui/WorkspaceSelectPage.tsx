import { useQuery } from '@tanstack/react-query'
import { workspaceEntryPath, workspaceListQueryOptions } from '@/entities/workspace'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { PagePlaceholder } from '@/shared/ui/page-placeholder'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'

const LIST = 'flex flex-col gap-8'

const LINK = 'text-body font-semibold text-ink underline'

const BADGE = 'ml-8 text-caption text-faint'

/** 소속 목록을 링크로만 보여 준다. 실제 선택 화면은 M4 다. 미완료 공간은 온보딩으로 간다 */
export function WorkspaceSelectPage() {
  return (
    <PagePlaceholder title="워크스페이스 선택" description="선택 화면은 M4에서 만들어요.">
      <WorkspaceLinks />
    </PagePlaceholder>
  )
}

function WorkspaceLinks() {
  const workspaces = useQuery(workspaceListQueryOptions())

  if (workspaces.data === undefined) {
    return workspaces.isError ? (
      <QueryErrorState error={workspaces.error} onRetry={() => void workspaces.refetch()} />
    ) : (
      <div aria-busy="true">
        <Skeleton lines={2} />
      </div>
    )
  }
  return (
    <ul className={LIST}>
      {workspaces.data.map((workspace) => (
        <li key={workspace.id}>
          <GuardedLink to={workspaceEntryPath(workspace)} className={LINK}>
            {workspace.name}
          </GuardedLink>
          {workspace.onboarding.completed ? null : <span className={BADGE}>설정 미완료</span>}
        </li>
      ))}
    </ul>
  )
}
