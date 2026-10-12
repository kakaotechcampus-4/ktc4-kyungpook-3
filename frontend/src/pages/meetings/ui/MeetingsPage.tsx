import { useParams } from 'react-router'
import { useMemberWorkspace } from '@/entities/workspace'
import { parseRouteId, useRouteId } from '@/shared/lib/url'
import { MeetingMinutes } from '@/widgets/meeting-minutes'
import { useDefaultMinutesSelection } from '../model/useDefaultMinutesSelection'

/**
 * `/meetings` 와 `/meetings/:meetingId` 가 같은 화면이다 (M5 U5). 라우트 조립만 한다 —
 * 고른 회의는 URL 이, 목록·회의록 조합은 widget 이, 기본 선택(가장 최근 회의록으로 `replace`)은 이 페이지가 맡는다.
 * 역할은 소속 목록의 role 이다. 소속은 RequireTeamMember 가 이미 확인했다.
 */
export function MeetingsPage() {
  const workspaceId = useRouteId('workspaceId')
  const workspace = useMemberWorkspace(workspaceId)
  const { meetingId: rawMeetingId } = useParams()
  const meetingId = parseRouteId(rawMeetingId)
  if (workspaceId === null || workspace === null) return null
  return (
    <Meetings
      workspaceId={workspaceId}
      meetingId={meetingId}
      invalidMeetingId={rawMeetingId !== undefined && meetingId === null}
      isPm={workspace.role === 'pm'}
    />
  )
}

function Meetings({
  workspaceId,
  meetingId,
  invalidMeetingId,
  isPm,
}: {
  workspaceId: string
  meetingId: string | null
  invalidMeetingId: boolean
  isPm: boolean
}) {
  useDefaultMinutesSelection(workspaceId, meetingId !== null || invalidMeetingId)
  return (
    <MeetingMinutes
      workspaceId={workspaceId}
      meetingId={meetingId}
      invalidMeetingId={invalidMeetingId}
      isPm={isPm}
    />
  )
}
