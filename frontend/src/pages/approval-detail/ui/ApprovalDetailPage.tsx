import { useFillInArrival } from '@/features/approval-resolve'
import { useRouteId } from '@/shared/lib/url'
import { ApprovalReview, UnavailableApproval } from '@/widgets/approval-review'

const ROOT = 'mx-auto flex w-full max-w-[960px] flex-col gap-24 px-36 pt-32 pb-56'

/**
 * `/workspaces/:workspaceId/approvals/:approvalId` — 확인 필요 상세 (M6 §4). 라우트 조립만 한다.
 * PM 가드를 통과해야 이 화면이 마운트된다. 업무 요청은 여기서 처음 시작한다.
 * 승인 ID 모양이 틀리면 API 를 부르지 않는다. 승인이 바뀌면 화면 상태(고친 값·충돌)를 새로 시작한다.
 * 대시보드 `채워 넣기` 로 왔으면 첫 빈 칸에 포커스를 두고 온다 (D-176) — 표시는 읽자마자 기록에서 지운다
 */
export function ApprovalDetailPage() {
  const workspaceId = useRouteId('workspaceId')
  const approvalId = useRouteId('approvalId')
  const fillIn = useFillInArrival()
  if (workspaceId === null) return null
  if (approvalId === null)
    return (
      <main className={ROOT}>
        <h1 className="text-caption font-semibold text-dim">확인 필요</h1>
        <UnavailableApproval workspaceId={workspaceId} />
      </main>
    )
  return (
    <ApprovalReview
      key={approvalId}
      workspaceId={workspaceId}
      approvalId={approvalId}
      fillInOnArrival={fillIn}
    />
  )
}
