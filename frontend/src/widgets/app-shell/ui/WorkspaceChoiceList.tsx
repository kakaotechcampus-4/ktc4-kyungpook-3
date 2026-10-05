import { useQuery } from '@tanstack/react-query'
import { workspaceListQueryOptions } from '@/entities/workspace'
import { useStartNewWorkspace } from '@/features/onboarding'
import { useEnterWorkspace } from '@/features/workspace-switch'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'
import { DashedIcon, WorkspaceRowContent } from './WorkspaceBadge'

const LIST = 'flex flex-col gap-1 rounded-[14px] border border-line bg-surface p-8'

const ROW =
  'flex w-full items-center gap-10 rounded-10 px-10 py-9 text-left hover:bg-surface-selected'

/**
 * 선택 화면의 공간 목록. 헤더 메뉴와 같은 줄 모양·같은 진입 정책이다.
 * 선택 화면은 어느 공간 안도 아니라서 미완료 공간의 온보딩 나가기는 이 화면으로 돌아온다(기억 없음).
 */
export function WorkspaceChoiceList() {
  const workspaces = useQuery(workspaceListQueryOptions())
  const enter = useEnterWorkspace()
  const startNew = useStartNewWorkspace()

  if (workspaces.data === undefined) {
    return workspaces.isError ? (
      <QueryErrorState error={workspaces.error} onRetry={() => void workspaces.refetch()} />
    ) : (
      <div aria-busy="true">
        <Skeleton lines={3} />
      </div>
    )
  }

  return (
    <div className={LIST}>
      {workspaces.data.length === 0 ? (
        <p className="px-10 py-9 text-body text-dim">아직 소속된 워크스페이스가 없어요.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {workspaces.data.map((workspace) => (
            <li key={workspace.id}>
              <button type="button" className={ROW} onClick={() => enter(workspace, null)}>
                <WorkspaceRowContent workspace={workspace} current={false} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <span className="mx-4 my-6 h-1 bg-divider" aria-hidden="true" />
      <button type="button" className={ROW} onClick={() => startNew(null)}>
        <DashedIcon name="plus" />
        <span className="flex-1 text-control font-semibold text-sub">새 워크스페이스 만들기</span>
      </button>
    </div>
  )
}
