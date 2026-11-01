import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useMemberWorkspace } from '@/entities/workspace'
import { MEMBERS_PARAMS } from '@/shared/config/routes'
import { todayInSeoul } from '@/shared/lib/date'
import { useRouteId } from '@/shared/lib/url'
import { TeamOverview } from '@/widgets/team'

/** 이 화면이 창을 열며 쌓은 기록에 남기는 표시. 주소로 바로 왔거나 D-074 로 온 기록에는 없다 */
interface ConnectHistoryState {
  connectPushed?: boolean
}

/**
 * `/workspaces/:workspaceId/members` — 팀 화면 (Team 캔버스). 라우트 조립만 한다. 설정과 따로 있는 화면이다(2026-10-30 사용자 답변).
 * 팀원 연결 창은 주소의 `connect=members` 가 쥔다 — 설정에서 Discord 를 연결하면 이 주소로 온다 (D-074). 열 때는 기록을 남겨
 * 뒤로 가기가 창을 닫는다. 닫을 때는 그 기록에서 한 칸 돌아온다 — 같은 주소의 기록이 남지 않는다. 이 화면이 쌓은 기록이 아니면
 * (주소로 바로 왔거나 D-074 로 왔으면) 뒤로 가지 않고 표시만 지운다. 일반 팀원에게는 창이 없다
 */
export function MembersPage() {
  const workspaceId = useRouteId('workspaceId')
  const workspace = useMemberWorkspace(workspaceId)
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  if (workspaceId === null || workspace === null) return null

  const isPm = workspace.role === 'pm'
  const pushedHere = (location.state as ConnectHistoryState | null)?.connectPushed === true
  const setConnectOpen = (open: boolean) => {
    if (!open && pushedHere) {
      void navigate(-1)
      return
    }
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (open) next.set(MEMBERS_PARAMS.connect, 'members')
        else next.delete(MEMBERS_PARAMS.connect)
        return next
      },
      open ? { state: { connectPushed: true } satisfies ConnectHistoryState } : { replace: true },
    )
  }

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
