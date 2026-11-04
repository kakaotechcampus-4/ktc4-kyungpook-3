import { useQuery } from '@tanstack/react-query'
import { workspaceListQueryOptions } from '@/entities/workspace'
import { useStartNewWorkspace } from '@/features/onboarding'
import { useEnterWorkspace } from '@/features/workspace-switch'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { Button } from '@/shared/ui/button'
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
export function WorkspaceChoiceList({
  showCreate = true,
  variant = 'default',
}: {
  showCreate?: boolean
  variant?: 'default' | 'onboarding'
}) {
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
    <div className={variant === 'onboarding' ? 'flex flex-col gap-1' : LIST}>
      {workspaces.data.length === 0 ? (
        <div className="flex flex-col items-start gap-12 px-10 py-9">
          <p className="text-body text-dim">아직 소속된 워크스페이스가 없어요.</p>
          {showCreate ? (
            <GuardedLink to={paths.onboardingStart()} className="text-body text-sub underline">
              시작 방식 다시 선택
            </GuardedLink>
          ) : null}
        </div>
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
      {workspaces.isError ? (
        <QueryErrorState error={workspaces.error} onRetry={() => void workspaces.refetch()} />
      ) : null}
      {showCreate ? (
        <>
          <span className="mx-4 my-6 h-1 bg-divider" aria-hidden="true" />
          <button type="button" className={ROW} onClick={() => startNew(null)}>
            <DashedIcon name="plus" />
            <span className="flex-1 text-control font-semibold text-sub">
              새 워크스페이스 만들기
            </span>
          </button>
        </>
      ) : variant === 'onboarding' ? (
        <div className="flex justify-end pt-8">
          <Button
            variant="primary"
            size="lg-onboarding"
            loading={workspaces.isFetching}
            onClick={() => void workspaces.refetch()}
          >
            목록 다시 확인
          </Button>
        </div>
      ) : (
        <Button loading={workspaces.isFetching} onClick={() => void workspaces.refetch()}>
          목록 다시 확인
        </Button>
      )}
    </div>
  )
}
