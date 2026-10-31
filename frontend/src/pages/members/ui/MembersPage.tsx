import { useSearchParams } from 'react-router'
import { useMemberWorkspace } from '@/entities/workspace'
import { MEMBERS_PARAMS } from '@/shared/config/routes'
import { todayInSeoul } from '@/shared/lib/date'
import { useRouteId } from '@/shared/lib/url'
import { TeamOverview } from '@/widgets/team'

/**
 * `/workspaces/:workspaceId/members` — 팀 화면 (Team 캔버스). 라우트 조립만 한다. 설정과 따로 있는 화면이다(2026-10-30 사용자 답변).
 * 팀원 연결 창은 주소의 `connect=members` 가 쥔다 — 설정에서 Discord 를 연결하면 이 주소로 온다 (D-074). 열 때는 기록을 남겨
 * 뒤로 가기가 창을 닫고, 닫을 때는 그 표시만 지운다. 일반 팀원에게는 창이 없다
 */
export function MembersPage() {
  const workspaceId = useRouteId('workspaceId')
  const workspace = useMemberWorkspace(workspaceId)
  const [searchParams, setSearchParams] = useSearchParams()
  if (workspaceId === null || workspace === null) return null

  const isPm = workspace.role === 'pm'
  const setConnectOpen = (open: boolean) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (open) next.set(MEMBERS_PARAMS.connect, 'members')
        else next.delete(MEMBERS_PARAMS.connect)
        return next
      },
      { replace: !open },
    )

  return (
    <TeamOverview
      key={workspaceId}
      workspaceId={workspaceId}
      isPm={isPm}
      today={todayInSeoul()}
      connectOpen={isPm && searchParams.get(MEMBERS_PARAMS.connect) === 'members'}
      onConnectOpenChange={setConnectOpen}
    />
  )
}
