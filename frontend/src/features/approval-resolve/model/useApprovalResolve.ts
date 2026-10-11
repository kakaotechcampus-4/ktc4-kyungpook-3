import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import {
  ApprovalNotResolvableError,
  approvalDetailQueryOptions,
  resolveApproval,
  toApprovalResolveFailure,
} from '@/entities/approval'
import type {
  Approval,
  ApprovalConflict,
  ApprovalDecision,
  TaskCreateFields,
} from '@/entities/approval'
import { taskDetailQueryOptions, taskHistoryQueryOptions, taskKeys } from '@/entities/task'
import { captureSession } from '@/entities/user'
import { errorMessage } from '@/shared/api/errorMessages'
import { isCanceledError } from '@/shared/api/errors'
import { workspaceKey } from '@/shared/api/queryKeys'
import { currentApprovalTransport } from './transport'

/** 승인 처리 mutation 의 key. 셋째 칸이 승인이라 같은 승인의 진행 중 요청을 따로 센다 */
export function approvalResolveMutationKey(workspaceId: string, approvalId: string) {
  return ['approval-resolve', workspaceId, approvalId] as const
}

export interface ApprovalResolveInput {
  decision: ApprovalDecision
  /** 생성 승인 보완값. `msw` 의 승인에서만 본문에 실린다. 반려는 무시한다 */
  overrides?: TaskCreateFields | null
  /** 변경 승인 재승인에서만. 충돌 응답이 돌려준 서버 버전이다 */
  confirmTaskVersion?: number | null
}

interface ResolveVariables extends ApprovalResolveInput {
  approval: Approval
  isCurrentSession: () => boolean
}

/** 화면이 승인 처리 실패를 그리는 모양 */
export type ApprovalResolveProblem =
  | { kind: 'conflict'; taskId: string; taskVersion: number; conflicts: ApprovalConflict[] }
  | { kind: 'already_resolved' }
  | { kind: 'error'; message: string }

export function toApprovalResolveProblem(error: unknown): ApprovalResolveProblem | null {
  if (error === null || error === undefined || isCanceledError(error)) return null
  if (error instanceof ApprovalNotResolvableError) return { kind: 'error', message: error.reason }
  const failure = toApprovalResolveFailure(error)
  if (failure?.kind === 'conflict')
    return {
      kind: 'conflict',
      taskId: failure.taskId,
      taskVersion: failure.taskVersion,
      conflicts: failure.conflicts,
    }
  if (failure?.kind === 'already_resolved') return { kind: 'already_resolved' }
  return { kind: 'error', message: errorMessage(error) }
}

/**
 * 승인 뒤 서버와 맞출 캐시 (계획 §4-6). 승인 목록·상세, 태스크 목록·상세·이력, 그 공간의 추출.
 * 추출 key 는 `entities/extraction` 의 `['workspace', id, 'extractions', extractionId]` 다 — 승인에는 추출 ID 가 없어 공간 전체를 본다.
 * 회의록의 `확인 필요` 는 열린 승인 목록과 조인하므로 `approval_id` 가 남은 항목도 다시 받은 목록에서 빠진다
 */
function syncAfterResolve(queryClient: QueryClient, workspaceId: string): void {
  for (const queryKey of [
    workspaceKey(workspaceId, 'approvals'),
    taskKeys(workspaceId),
    workspaceKey(workspaceId, 'extractions'),
  ])
    void queryClient.invalidateQueries({ queryKey })
}

export interface ApprovalResolve {
  /** 승인·반려한다. 같은 승인의 요청이 진행 중이면 아무것도 하지 않는다. 자동으로 다시 보내지 않는다 */
  resolve: (approval: Approval, input: ApprovalResolveInput) => void
  /** 이 승인의 처리가 진행 중이다 */
  pending: boolean
  /** 진행 중인 처리의 결정. 누른 버튼에 진행 표시를 한다 */
  pendingDecision: ApprovalDecision | null
  /** 마지막 처리의 실패. 다시 처리를 시작하면 사라진다 */
  problem: ApprovalResolveProblem | null
}

/**
 * PM 의 승인·반려 (계획 §4-3, §4-5, §4-6).
 * - 본문은 `resolveApproval`(→ `planApprovalResolution`) 이 허락한 것만 보낸다. 보완값은 `msw` 에서만 싣는다
 * - 화면 반영은 서버 성공 뒤다. 돌려받은 승인을 상세 캐시에 쓰고 관련 캐시를 무효화한다
 * - 충돌(409 APPROVAL_CONFLICT)은 그대로 돌려준다. 재승인은 PM 이 다시 누를 때만이며 그때 서버 버전을 싣는다
 * - 이미 처리됨(409)이면 재처리하지 않고 승인을 다시 받아 지금 결과를 보인다
 * - mutation 자동 재시도는 없다. 같은 틱의 두 번째 누름도 막는다
 * - 요청 중 세션이 끝났으면 늦은 응답은 캐시에 아무것도 남기지 않는다
 */
export function useApprovalResolve(
  workspaceId: string,
  approvalId: string,
  memberIds: readonly string[],
): ApprovalResolve {
  const queryClient = useQueryClient()
  const mutationKey = approvalResolveMutationKey(workspaceId, approvalId)
  const inFlight = useIsMutating({ mutationKey }) > 0

  const { mutate, isPending, variables, error } = useMutation({
    mutationKey,
    retry: false,
    mutationFn: ({ approval, decision, overrides, confirmTaskVersion }: ResolveVariables) =>
      resolveApproval(workspaceId, approval, decision, {
        transport: currentApprovalTransport(),
        memberIds,
        overrides,
        confirmTaskVersion,
      }),
    onSuccess: (resolved, { isCurrentSession }) => {
      if (!isCurrentSession()) return
      queryClient.setQueryData(
        approvalDetailQueryOptions(workspaceId, resolved.id).queryKey,
        resolved,
      )
      syncAfterResolve(queryClient, workspaceId)
    },
    onError: (failure, { isCurrentSession }) => {
      if (!isCurrentSession()) return
      const problem = toApprovalResolveProblem(failure)
      if (problem?.kind === 'already_resolved') syncAfterResolve(queryClient, workspaceId)
      if (problem?.kind === 'conflict')
        for (const { queryKey } of [
          taskDetailQueryOptions(workspaceId, problem.taskId),
          taskHistoryQueryOptions(workspaceId, problem.taskId),
        ])
          void queryClient.invalidateQueries({ queryKey, exact: true })
    },
  })

  const resolve = useCallback(
    (approval: Approval, input: ApprovalResolveInput) => {
      if (
        queryClient.isMutating({
          mutationKey: approvalResolveMutationKey(workspaceId, approvalId),
        }) > 0
      )
        return
      mutate({ ...input, approval, isCurrentSession: captureSession() })
    },
    [queryClient, mutate, workspaceId, approvalId],
  )

  return {
    resolve,
    pending: isPending || inFlight,
    pendingDecision: isPending ? (variables?.decision ?? null) : null,
    problem: isPending ? null : toApprovalResolveProblem(error),
  }
}
