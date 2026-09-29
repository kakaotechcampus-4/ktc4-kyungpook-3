import type { Workspace } from '@/entities/workspace'
import { Icon } from '@/shared/ui/icon'
import { workspaceMeta } from '../lib/workspaceMeta'

/* Main 팀 메뉴의 한 줄 — 28px 머리글자 · 이름 · 보조 줄 · 현재 공간 체크 */
const BADGE =
  'inline-flex h-28 w-28 shrink-0 items-center justify-center rounded-8 text-[11px] leading-none font-semibold'

const NAME = 'truncate text-control leading-[1.4] font-semibold text-ink'

const META = 'text-[11px] leading-[1.4] text-dim'

export interface WorkspaceRowContentProps {
  workspace: Workspace
  current: boolean
}

/** 메뉴 항목과 선택 화면 버튼이 같이 쓰는 안쪽 모양. 누르는 요소는 바깥이 정한다 */
export function WorkspaceRowContent({ workspace, current }: WorkspaceRowContentProps) {
  return (
    <>
      <span
        aria-hidden="true"
        className={`${BADGE} ${current ? 'bg-ink text-surface' : 'bg-divider text-ink'}`}
      >
        {Array.from(workspace.name)[0] ?? ''}
      </span>
      <span className="flex min-w-[0px] flex-1 flex-col gap-1">
        <span className={NAME}>{workspace.name}</span>
        <span className={META}>{workspaceMeta(workspace)}</span>
      </span>
      {current ? (
        <Icon name="check" size={15} className="shrink-0 text-ink" label="지금 보는 워크스페이스" />
      ) : (
        <span className="h-[15px] w-[15px] shrink-0" />
      )}
    </>
  )
}

/** `새 워크스페이스 만들기` · `워크스페이스 설정` 줄의 점선 아이콘 칸 */
export function DashedIcon({ name }: { name: 'plus' | 'settings' }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-28 w-28 shrink-0 items-center justify-center rounded-8 border border-dashed text-sub"
    >
      <Icon name={name} size={14} />
    </span>
  )
}
