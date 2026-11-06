import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { captureAccountIntro } from '@/entities/user'
import { useMemberWorkspace } from '@/entities/workspace'
import { paths } from '@/shared/config/routes'
import { todayInSeoul } from '@/shared/lib/date'
import { useRouteId } from '@/shared/lib/url'
import { Dashboard } from '@/widgets/dashboard'
import { boardSearch } from '@/widgets/task-board'
import type { BoardQuery } from '@/widgets/task-board'
import { FirstVisitIntro } from '@/widgets/first-visit-intro'

const NO_PARAMS = new URLSearchParams()

/**
 * `/workspaces/:workspaceId/dashboard` — 대시보드 (M7). 라우트 조립만 한다. 온보딩이 끝나는 곳이다(D-013).
 * 태스크 목록으로 가는 주소는 목록의 URL 규칙(`boardSearch`)으로 만든다 — 대시보드가 목록 조건을 따로 적지 않는다.
 * 요약 숫자의 주소는 그 수만큼 보이는 조건이다 (D-178).
 * 역할은 소속 목록의 role 이다. 공간이 바뀌면 key 로 화면 상태(열린 확인 모달·되돌리기 결과)를 새로 시작한다.
 * 이 브라우저에서 온보딩을 마친 계정은 처음 들어올 때 매스 인트로를 한 번 본다 (#430). 공간을 바꿔도 다시 열지 않는다.
 */
export function DashboardPage() {
  const workspaceId = useRouteId('workspaceId')
  const workspace = useMemberWorkspace(workspaceId)
  const queryClient = useQueryClient()
  const [intro] = useState(() => captureAccountIntro(queryClient))
  const [introOpen, setIntroOpen] = useState(() => intro?.isDue() ?? false)
  if (workspaceId === null || workspace === null) return null

  const tasks = paths.tasks(workspaceId)
  const board = (query: BoardQuery) => `${tasks}${boardSearch(NO_PARAMS, query)}`
  const needsReview = board({ tab: 'needs_review', due: [] })
  return (
    <>
      <Dashboard
        key={workspaceId}
        workspaceId={workspaceId}
        isPm={workspace.role === 'pm'}
        today={todayInSeoul()}
        needsReviewHref={needsReview}
        dueSoonHref={board({ tab: 'in_progress', due: ['overdue', 'soon'] })}
        summaryHrefs={{
          needsReview,
          overdue: board({ tab: 'in_progress', due: ['overdue'] }),
          dueSoon: board({ tab: 'in_progress', due: ['soon'] }),
          blocked: board({ tab: 'in_progress', due: ['blocked'] }),
        }}
      />
      <FirstVisitIntro
        open={introOpen}
        onClose={() => {
          intro?.markSeen()
          setIntroOpen(false)
        }}
      />
    </>
  )
}
