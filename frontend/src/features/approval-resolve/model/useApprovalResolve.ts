import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
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
  ApprovalEdits,
  TaskCreateEdits,
  TaskUpdateEdits,
} from '@/entities/approval'
import { taskDetailQueryOptions, taskHistoryQueryOptions, taskKeys } from '@/entities/task'
import { captureSession } from '@/entities/user'
import { errorMessage } from '@/shared/api/errorMessages'
import { isCanceledError } from '@/shared/api/errors'
import { workspaceKey } from '@/shared/api/queryKeys'

/** 승인 처리 mutation 의 key. 셋째 칸이 승인이라 같은 승인의 진행 중 요청을 따로 센다 */
export function approvalResolveMutationKey(workspaceId: string, approvalId: string) {
  return ['approval-resolve', workspaceId, approvalId] as const
}

interface ResolveVariables {
  decision: ApprovalDecision
  edits: ApprovalEdits | null
  confirmTaskVersion?: number
  revision: number
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
  draft: ApprovalEdits | null
  editCreate: (edits: TaskCreateEdits) => void
  editUpdate: (edits: TaskUpdateEdits) => void
  invalidateConfirmation: () => void
  approve: (approval: Approval) => void
  reapprove: (approval: Approval) => void
  reject: (approval: Approval) => void
  pending: boolean
  pendingDecision: ApprovalDecision | null
  problem: ApprovalResolveProblem | null
}

export function useApprovalResolve(
  workspaceId: string,
  approvalId: string,
  memberIds: readonly string[],
): ApprovalResolve {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ApprovalEdits | null>(null)
  const draftRef = useRef<ApprovalEdits | null>(null)
  const revision = useRef(0)
  const mutationKey = approvalResolveMutationKey(workspaceId, approvalId)
  const inFlight = useIsMutating({ mutationKey }) > 0

  const { mutate, isPending, variables, error, reset } = useMutation({
    mutationKey,
    retry: false,
    mutationFn: ({ approval, decision, edits, confirmTaskVersion }: ResolveVariables) =>
      resolveApproval(workspaceId, approval, decision, {
        memberIds,
        edits,
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

  const invalidateConfirmation = useCallback(() => {
    revision.current += 1
    reset()
  }, [reset])

  const edit = useCallback(
    (next: ApprovalEdits) => {
      invalidateConfirmation()
      const previous = draftRef.current
      const merged: ApprovalEdits =
        next.kind === 'task_create'
          ? {
              kind: 'task_create',
              values: {
                ...(previous?.kind === 'task_create' ? previous.values : {}),
                ...next.values,
              },
            }
          : {
              kind: 'task_update',
              values: {
                ...(previous?.kind === 'task_update' ? previous.values : {}),
                ...next.values,
              },
            }
      draftRef.current = merged
      setDraft(merged)
    },
    [invalidateConfirmation],
  )

  const resolve = useCallback(
    (approval: Approval, decision: ApprovalDecision, confirm = false) => {
      if (
        queryClient.isMutating({
          mutationKey: approvalResolveMutationKey(workspaceId, approvalId),
        }) > 0
      )
        return
      const problem = toApprovalResolveProblem(error)
      if (confirm && (problem?.kind !== 'conflict' || variables?.revision !== revision.current))
        return
      const edits = confirm ? (variables?.edits ?? null) : draftRef.current
      mutate({
        approval,
        decision,
        edits:
          decision === 'rejected'
            ? null
            : edits === null
              ? null
              : { ...edits, values: { ...edits.values } },
        revision: revision.current,
        ...(confirm && problem?.kind === 'conflict'
          ? { confirmTaskVersion: problem.taskVersion }
          : {}),
        isCurrentSession: captureSession(),
      })
    },
    [queryClient, mutate, workspaceId, approvalId, error, variables],
  )

  return {
    draft,
    editCreate: (edits) => edit({ kind: 'task_create', values: edits }),
    editUpdate: (edits) => edit({ kind: 'task_update', values: edits }),
    invalidateConfirmation,
    approve: (approval) => resolve(approval, 'approved'),
    reapprove: (approval) => resolve(approval, 'approved', true),
    reject: (approval) => resolve(approval, 'rejected'),
    pending: isPending || inFlight,
    pendingDecision: isPending ? (variables?.decision ?? null) : null,
    problem: isPending ? null : toApprovalResolveProblem(error),
  }
}
