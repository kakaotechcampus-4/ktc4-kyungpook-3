import { useQuery } from '@tanstack/react-query'
import { findMemberWorkspace, workspaceListQueryOptions } from '@/entities/workspace'
import { useStartNewWorkspace } from '@/features/onboarding'
import { useEnterWorkspace } from '@/features/workspace-switch'
import { paths } from '@/shared/config/routes'
import { useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Icon } from '@/shared/ui/icon'
import { DashedIcon, WorkspaceRowContent } from './WorkspaceBadge'

export interface WorkspaceMenuProps {
  /** 지금 보고 있는 공간 */
  workspaceId: string
}

/* Main 의 .team-btn — 36px · 반경 9 · 선 테두리. 열려 있으면 선택 면이다 */
const TRIGGER =
  'inline-flex h-36 max-w-[240px] items-center gap-8 rounded-9 border border-line bg-surface px-11 text-control font-semibold text-ink hover:bg-surface-sunken data-[state=open]:bg-surface-selected'

const ACTION_TEXT = 'flex-1 text-control font-semibold text-sub'

/**
 * 헤더의 워크스페이스 메뉴 (D-066~D-070). 선택 화면과 같은 목록·같은 진입 정책(`useEnterWorkspace`)을 쓴다.
 * 공간을 고르면 완료 공간은 대시보드, 미완료 공간은 온보딩 재개 지점이다. 저장하지 않은 변경이 있으면 먼저 묻는다.
 * `새 워크스페이스 만들기` 는 지금 공간을 돌아올 곳으로 기억한다 (D-068, D-069).
 * 설정은 탭이 아니라 이 메뉴에서 연다.
 */
export function WorkspaceMenu({ workspaceId }: WorkspaceMenuProps) {
  const workspaces = useQuery(workspaceListQueryOptions())
  const enter = useEnterWorkspace()
  const startNew = useStartNewWorkspace()
  const navigate = useGuardedNavigate()
  const list = workspaces.data ?? []
  const current = findMemberWorkspace(list, workspaceId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={TRIGGER}
        aria-label={`워크스페이스 바꾸기: ${current?.name ?? ''}`}
      >
        <span className="truncate">{current?.name}</span>
        <Icon name="chevron-down" size={14} className="shrink-0 text-dim" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>내 워크스페이스 {list.length}</DropdownMenuLabel>
        {list.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onSelect={() => enter(workspace, workspaceId)}>
            <WorkspaceRowContent workspace={workspace} current={workspace.id === workspaceId} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => startNew(workspaceId)}>
          <DashedIcon name="plus" />
          <span className={ACTION_TEXT}>새 워크스페이스 만들기</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate(paths.settings(workspaceId))}>
          <DashedIcon name="settings" />
          <span className={ACTION_TEXT}>워크스페이스 설정</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate(paths.workspaceSelect())}>
          <span className="h-28 w-28 shrink-0" aria-hidden="true" />
          <span className={ACTION_TEXT}>워크스페이스 목록</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
