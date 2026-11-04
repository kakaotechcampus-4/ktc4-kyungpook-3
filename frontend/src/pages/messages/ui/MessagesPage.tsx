import { Route, Routes, useParams, useSearchParams } from 'react-router'
import { useMemberWorkspace } from '@/entities/workspace'
import { config } from '@/shared/config/env'
import { MESSAGE_PARAMS } from '@/shared/config/routes'
import { parseRouteId, useRouteId } from '@/shared/lib/url'
import { EmptyState } from '@/shared/ui/empty-state'
import { MessageInbox } from '@/widgets/message-inbox'

const SCREEN = 'flex min-h-dvh items-center justify-center px-24 py-48'

/**
 * 메시지 API 가 없어 새 화면은 개발 서버 + MSW 일 때만 그린다 (M8 계획 C-3 의 임시 기본값 — 최종 결정 아님).
 * 실 API 모드와 production 은 준비 중 안내 그대로이고 API 도 부르지 않는다 (D-174).
 * DEV 를 먼저 본다 — 번들러가 이 분기를 지워야 프로덕션 번들에 새 화면 코드가 남지 않는다
 */
export function MessagesPage() {
  return import.meta.env.DEV && config.mswEnabled ? <MessagesRoutes /> : <MessagesComingSoon />
}

function MessagesComingSoon() {
  return (
    <main className={SCREEN}>
      <EmptyState
        title="메시지는 준비 중이에요"
        description="메시지 발송 기능이 준비되면 열려요."
      />
    </main>
  )
}

/**
 * 라우트 표의 `messages/*` 아래 하위 경로. `messages` 는 목록, `messages/threads/:threadId` 는 사람별 대화다.
 * 그 밖의 하위 경로는 없는 대화로 알린다. 하위 경로는 임시라 규약이 아니다 (paths.messageThread)
 */
function MessagesRoutes() {
  return (
    <Routes>
      <Route index element={<Messages />} />
      <Route path="threads/:threadId" element={<Messages />} />
      <Route path="*" element={<Messages unknownPath />} />
    </Routes>
  )
}

/**
 * 고른 대화는 경로가, 고른 보내기 전 확인 항목은 검색 파라미터 `review` 가 정한다. URL 값은 여기서 한 번 검증한다 (D-132).
 * 소속은 RequireTeamMember 가 이미 확인했다
 */
function Messages({ unknownPath = false }: { unknownPath?: boolean }) {
  const workspaceId = useRouteId('workspaceId')
  const workspace = useMemberWorkspace(workspaceId)
  const { threadId: rawThreadId } = useParams()
  const [searchParams] = useSearchParams()
  if (workspaceId === null || workspace === null) return null
  const threadId = parseRouteId(rawThreadId)
  const rawReviewId = searchParams.get(MESSAGE_PARAMS.review)
  return (
    <MessageInbox
      workspaceId={workspaceId}
      botName={workspace.name}
      viewer={workspace.role}
      threadId={threadId}
      reviewId={rawReviewId === null ? undefined : parseRouteId(rawReviewId)}
      invalidPath={unknownPath || (rawThreadId !== undefined && threadId === null)}
    />
  )
}
