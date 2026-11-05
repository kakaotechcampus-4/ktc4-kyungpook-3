import { Route, Routes, useParams, useSearchParams } from 'react-router'
import { useMemberWorkspace } from '@/entities/workspace'
import { MESSAGE_PARAMS } from '@/shared/config/routes'
import { parseRouteId, useRouteId } from '@/shared/lib/url'
import { MessageInbox } from '@/widgets/message-inbox'

/**
 * 라우트 표의 `messages/*` 아래 하위 경로. `messages` 는 목록, `messages/threads/:threadId` 는 팀원 한 명과의 대화다.
 * 그 밖의 하위 경로는 없는 대화로 알린다 (paths.messageThread)
 */
export function MessagesPage() {
  return (
    <Routes>
      <Route index element={<Messages />} />
      <Route path="threads/:threadId" element={<Messages />} />
      <Route path="*" element={<Messages unknownPath />} />
    </Routes>
  )
}

/**
 * 고른 대화는 경로가, 고른 보낼 메시지(묶음)는 검색 파라미터 `review` 가, 재촉 만들기는 `new=reminder` 가 정한다.
 * URL 값은 여기서 한 번 검증한다 (D-132).
 * 소속은 RequireTeamMember 가 이미 확인했다
 */
function Messages({ unknownPath = false }: { unknownPath?: boolean }) {
  const workspaceId = useRouteId('workspaceId')
  const workspace = useMemberWorkspace(workspaceId)
  const { threadId: rawThreadId } = useParams()
  const [searchParams] = useSearchParams()
  if (workspaceId === null || workspace === null) return null
  const threadId = parseRouteId(rawThreadId)
  const rawBundleId = searchParams.get(MESSAGE_PARAMS.review)
  return (
    <MessageInbox
      workspaceId={workspaceId}
      botName={workspace.name}
      viewer={workspace.role}
      threadId={threadId}
      bundleId={rawBundleId === null ? undefined : parseRouteId(rawBundleId)}
      invalidPath={unknownPath || (rawThreadId !== undefined && threadId === null)}
      composing={searchParams.get(MESSAGE_PARAMS.compose) === 'reminder'}
    />
  )
}
