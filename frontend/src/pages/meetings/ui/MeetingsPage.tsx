import { useState } from 'react'
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
  const latestId = useDefaultMinutesSelection(workspaceId, meetingId !== null || invalidMeetingId)
  // 목록을 이미 받아 둔 채 들어왔으면(셸의 미리 받기, 다시 방문) 주소를 바꾸기 전 첫 렌더부터 기본 회의를 그린다 — 주소가 바뀔 때까지
  // 본문이 빈 자리로 한두 프레임 비지 않는다 (#536). 목록이 들어온 뒤 늦게 왔으면 전처럼 주소가 바뀐 뒤에 그린다 —
  // 그 사이 다른 곳으로 떠나는 중이면 기본 회의를 부르지 않는다
  const [listedAtMount] = useState(latestId !== undefined)
  const shownMeetingId =
    meetingId ?? (listedAtMount && !invalidMeetingId ? (latestId ?? null) : null)
  return (
    <MeetingMinutes
      workspaceId={workspaceId}
      meetingId={shownMeetingId}
      invalidMeetingId={invalidMeetingId}
      isPm={isPm}
    />
  )
}
