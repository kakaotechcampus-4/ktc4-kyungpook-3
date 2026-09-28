import { useQuery } from '@tanstack/react-query'
import { approvalDetailQueryOptions } from '@/entities/approval'
import type { Approval } from '@/entities/approval'
import { useRouteId } from '@/shared/lib/url'
import { PagePlaceholder } from '@/shared/ui/page-placeholder'
import { QueryErrorState } from '@/shared/ui/query-error-state'
import { Skeleton } from '@/shared/ui/skeleton'

const BODY = 'text-body text-ink'

/** PM 가드를 통과해야 이 화면이 마운트된다. 업무 요청은 여기서 처음 시작한다 */
export function ApprovalDetailPage() {
  const workspaceId = useRouteId('workspaceId')
  const approvalId = useRouteId('approvalId')

  return (
    <PagePlaceholder title="확인 필요" description="확인 필요 상세 화면은 M6에서 만들어요.">
      {workspaceId === null || approvalId === null ? (
        <p className={BODY}>확인 요청을 찾을 수 없어요.</p>
      ) : (
        <ApprovalSummary workspaceId={workspaceId} approvalId={approvalId} />
      )}
    </PagePlaceholder>
  )
}

interface ApprovalSummaryProps {
  workspaceId: string
  approvalId: string
}

function ApprovalSummary({ workspaceId, approvalId }: ApprovalSummaryProps) {
  const approval = useQuery(approvalDetailQueryOptions(workspaceId, approvalId))

  if (approval.data === undefined) {
    return approval.isError ? (
      <QueryErrorState error={approval.error} onRetry={() => void approval.refetch()} />
    ) : (
      <div aria-busy="true">
        <Skeleton lines={2} />
      </div>
    )
  }
  return <p className={BODY}>{approvalTitle(approval.data)}</p>
}

function approvalTitle(approval: Approval): string {
  return approval.kind === 'unsupported' ? approval.type : (approval.title ?? '')
}
