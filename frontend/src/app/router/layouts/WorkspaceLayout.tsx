import { Fragment } from 'react'
import { Outlet } from 'react-router'
import { paths } from '@/shared/config/routes'
import { GuardedLink } from '@/shared/lib/unsaved-changes'
import { useRouteId } from '@/shared/lib/url'

/* M3 점검용 임시 이동이다. 실제 헤더와 5개 탭은 M4 몫이라 모양을 맞추지 않는다.
   브라우저에서 내부 링크 이동과 이탈 확인을 눌러 보려고만 둔다. */
const LINKS: { label: string; to: (workspaceId: string) => string }[] = [
  { label: '대시보드', to: paths.dashboard },
  { label: '회의', to: (workspaceId) => paths.meetings(workspaceId) },
  { label: '태스크', to: (workspaceId) => paths.tasks(workspaceId) },
  { label: '메시지', to: paths.messages },
  { label: '팀원', to: paths.members },
  { label: '설정', to: paths.settings },
]

const NAV = 'flex flex-wrap items-center gap-12 border-b border-line px-24 py-12'

const LINK = 'text-caption text-dim aria-[current=page]:font-semibold aria-[current=page]:text-ink'

export function WorkspaceLayout() {
  const workspaceId = useRouteId('workspaceId')
  if (workspaceId === null) return null

  return (
    <>
      <nav aria-label="M3 점검용 이동" className={NAV}>
        {LINKS.map(({ label, to }) => (
          <GuardedLink key={label} to={to(workspaceId)} className={LINK}>
            {label}
          </GuardedLink>
        ))}
        <GuardedLink to={paths.workspaceSelect()} end className={LINK}>
          워크스페이스 목록
        </GuardedLink>
      </nav>
      {/* 공간이 바뀌면 화면을 새로 마운트한다. 이전 공간의 화면 상태가 새 공간으로 넘어가지 않는다 */}
      <Fragment key={workspaceId}>
        <Outlet />
      </Fragment>
    </>
  )
}
