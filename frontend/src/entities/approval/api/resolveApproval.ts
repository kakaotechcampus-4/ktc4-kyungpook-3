import { request } from '@/shared/api/client'
import type { ApprovalDto } from '@/shared/types/api/approval'
import { toApproval, toApprovalResolveRequestDto } from '../model/mapper'
import { planApprovalResolution, toApprovalTransport } from '../model/resolution'
import type { ApprovalDecision, ApprovalResolveContext, TaskCreateIssue } from '../model/resolution'
import type { Approval } from '../model/types'

/** 판정을 통과하지 못해 요청을 보내지 않았다. `reason` 은 화면에 그대로 쓸 수 있다 */
export class ApprovalNotResolvableError extends Error {
  readonly reason: string
  readonly issues: TaskCreateIssue[]

  constructor(reason: string, issues: TaskCreateIssue[] = []) {
    super(reason)
    this.name = 'ApprovalNotResolvableError'
    this.reason = reason
    this.issues = issues
  }
}

/**
 * 승인·반려 (`PATCH /approvals/{approval_id}`, PM 전용). 본문은 `planApprovalResolution` 이 허락한 것만 보낸다.
 * 판정을 통과하지 못하거나 다른 공간의 승인이면 요청하지 않고 `ApprovalNotResolvableError` 를 던진다.
 * 409 는 `toApprovalResolveFailure` 로 충돌·이미 처리됨을 구분한다. 자동으로 다시 보내지 않는다
 */
export async function resolveApproval(
  workspaceId: string,
  approval: Approval,
  decision: ApprovalDecision,
  context: ApprovalResolveContext = {},
): Promise<Approval> {
  if (approval.workspaceId !== workspaceId)
    throw new ApprovalNotResolvableError('다른 워크스페이스의 확인 요청이에요.')
  const plan = planApprovalResolution(approval, decision, context)
  if (!plan.ok) throw new ApprovalNotResolvableError(plan.reason, plan.issues)
  return toApproval(
    await request<ApprovalDto>(`/approvals/${encodeURIComponent(approval.id)}`, {
      method: 'PATCH',
      body: toApprovalResolveRequestDto(plan.resolution, toApprovalTransport(context.transport)),
    }),
  )
}
