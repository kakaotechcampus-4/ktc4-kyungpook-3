import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import {
  extractionKeys,
  extractionQueryOptions,
  revertAutoItem,
  toAutoItemRevertRejection,
} from '@/entities/extraction'
import type { AutoItemRevert, AutoItemRevertReason } from '@/entities/extraction'
import { taskKeys } from '@/entities/task'
import { captureSession } from '@/entities/user'
import { errorMessage } from '@/shared/api/errorMessages'
import { workspaceKey } from '@/shared/api/queryKeys'
import { toast } from '@/shared/ui/toast'
import { REVERT_SUCCESS, revertRejectionMessage } from '../lib/revertMessage'

/** 되돌리기 mutation 의 key. 한 공간에서 되돌리기는 한 번에 하나다 */
export function autoItemRevertMutationKey(workspaceId: string) {
  return ['auto-item-revert', workspaceId] as const
}

/** 한 항목의 마지막 되돌리기 결과. 다시 되돌리기를 시작하면 사라진다 */
export type AutoItemRevertOutcome =
  | { kind: 'reverted'; approvalId: string }
  | {
      kind: 'rejected'
      reason: AutoItemRevertReason
      message: string
      /** `task_changed` 등에서 서버가 알려 준 태스크 */
      taskId: string | null
      /** `pending_approval` 에서 서버가 알려 준 대기 승인 */
      approvalId: string | null
    }
  | { kind: 'error'; message: string }

interface RevertVariables {
  extractionId: string
  itemId: string
  isCurrentSession: () => boolean
}

/**
 * 되돌리기 뒤 서버와 맞출 캐시. 지운 태스크(목록·상세), 새 생성 승인(대기 목록), 항목의 연결(추출).
 * 실패해도 같은 캐시를 다시 받는다 — 거절 사유가 다른 화면의 변경 때문일 수 있다
 */
function syncAfterRevert(queryClient: QueryClient, workspaceId: string): void {
  for (const queryKey of [
    taskKeys(workspaceId),
    workspaceKey(workspaceId, 'approvals'),
    extractionKeys(workspaceId),
  ])
    void queryClient.invalidateQueries({ queryKey })
}

export interface AutoItemRevertControl {
  /** 되돌린다. 진행 중인 되돌리기가 있으면 아무것도 하지 않는다. 끝나면(성공·실패) `onSettled` 를 부른다 */
  revert: (extractionId: string, itemId: string, onSettled?: () => void) => void
  /** 진행 중인 항목. 없으면 null */
  pendingItemId: string | null
  /** 항목별 마지막 결과 */
  outcomes: ReadonlyMap<string, AutoItemRevertOutcome>
}

/**
 * PM 의 auto 태스크 되돌리기 (계획 §4, D-036·D-037·D-137).
 * - 서버 성공 뒤에만 반영한다. 낙관적 업데이트는 없다. 성공 응답을 그 추출 캐시의 항목에 쓰고 관련 캐시를 무효화한다.
 *   결과 알림(토스트)도 그때 한 번 띄운다 (D-037)
 * - 거절(409)은 사유별 안내로, 그 밖의 실패(403·404·네트워크)는 공통 오류 문구로 남긴다. 둘 다 최신 상태를 다시 받는다
 * - 자동 재시도는 없다. 같은 틱의 두 번째 누름도 막는다
 * - 요청 중 세션이 끝났으면 늦은 응답은 캐시에도 결과에도 남기지 않는다
 */
export function useAutoItemRevert(workspaceId: string): AutoItemRevertControl {
  const queryClient = useQueryClient()
  const mutationKey = autoItemRevertMutationKey(workspaceId)
  const inFlight = useIsMutating({ mutationKey }) > 0
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, AutoItemRevertOutcome>>(
    () => new Map(),
  )

  const record = useCallback((itemId: string, outcome: AutoItemRevertOutcome | null) => {
    setOutcomes((current) => {
      const next = new Map(current)
      if (outcome === null) next.delete(itemId)
      else next.set(itemId, outcome)
      return next
    })
  }, [])

  const { mutate, isPending, variables } = useMutation<AutoItemRevert, Error, RevertVariables>({
    mutationKey,
    retry: false,
    mutationFn: ({ extractionId, itemId }) => revertAutoItem(extractionId, itemId),
    onSuccess: (reverted, { extractionId, itemId, isCurrentSession }) => {
      if (!isCurrentSession()) return
      queryClient.setQueryData(
        extractionQueryOptions(workspaceId, extractionId).queryKey,
        (current) =>
          current && {
            ...current,
            items: current.items.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    appliedTaskId: null,
                    approvalId: reverted.approvalId,
                    approvalStatus: 'pending' as const,
                    revertedAt: reverted.revertedAt,
                  }
                : item,
            ),
          },
      )
      record(itemId, { kind: 'reverted', approvalId: reverted.approvalId })
      toast.show({ key: 'auto-item-revert', ...REVERT_SUCCESS })
      syncAfterRevert(queryClient, workspaceId)
    },
    onError: (error, { itemId, isCurrentSession }) => {
      if (!isCurrentSession()) return
      const rejection = toAutoItemRevertRejection(error)
      record(
        itemId,
        rejection === null
          ? { kind: 'error', message: errorMessage(error) }
          : {
              kind: 'rejected',
              reason: rejection.reason,
              message: revertRejectionMessage(rejection.reason),
              taskId: rejection.taskId,
              approvalId: rejection.approvalId,
            },
      )
      syncAfterRevert(queryClient, workspaceId)
    },
  })

  const revert = useCallback(
    (extractionId: string, itemId: string, onSettled?: () => void) => {
      if (queryClient.isMutating({ mutationKey: autoItemRevertMutationKey(workspaceId) }) > 0)
        return
      record(itemId, null)
      mutate({ extractionId, itemId, isCurrentSession: captureSession() }, { onSettled })
    },
    [queryClient, mutate, record, workspaceId],
  )

  return {
    revert,
    pendingItemId: isPending || inFlight ? (variables?.itemId ?? null) : null,
    outcomes,
  }
}
