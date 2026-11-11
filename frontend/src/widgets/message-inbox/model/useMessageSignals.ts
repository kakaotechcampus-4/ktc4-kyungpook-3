import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { connectMessageSignals, messageKeys } from '@/entities/message'
import { hasReadableResponse } from '@/shared/api/queryClient'
import { captureSessionScope } from '@/shared/api/sessionScope'

/**
 * 메시지 화면이 떠 있는 동안 대화 신호를 받아 그 공간의 메시지 조회를 다시 부른다. 끊겨도 화면에 표시하지 않는다.
 * 화면이 내려가거나 공간이 바뀌면 닫고, 연 세션이 끝나면 화면이 아직 떠 있어도 닫는다 — 다음 세션의 캐시에 닿지 않는다.
 *
 * 받는 중인 조회는 신호 전의 서버 상태일 수 있다. 무효화만 하면 Query 가 그 조회를 다시 쓰고 끝날 때 무효 표시도 지워서
 * 신호가 사라진다(데이터가 없는 첫 조회는 `cancelRefetch` 로도 끊기지 않는다).
 * 응답을 읽지 못한 조회는 신호로 다시 받지 않는다. 화면의 다시 시도가 성공하면 다음 신호부터 다시 받는다 (D-184)
 */
export function useMessageSignals(workspaceId: string): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const queryKey = messageKeys(workspaceId)
    const session = captureSessionScope()
    let live = true
    let stopWaiting = () => {}
    const canRefetch = () => live && session.isCurrent()
    const refetch = () =>
      void queryClient.invalidateQueries({ queryKey, predicate: hasReadableResponse })

    // 열렸을 때 받는 중인 조회는 끊지 않는다 — 첫 화면의 첫 조회를 끊어 다시 받으면 목록이 그만큼 늦게 뜬다.
    // 대신 끝나기를 기다려 한 번 더 받는다. 서버는 끊긴 동안의 신호를 다시 보내지 않는다
    function refetchAfterInFlight(): void {
      stopWaiting()
      if (queryClient.isFetching({ queryKey }) === 0) return refetch()
      const unsubscribe = queryClient.getQueryCache().subscribe(() => {
        if (!canRefetch()) return stopWaiting()
        if (queryClient.isFetching({ queryKey }) > 0) return
        stopWaiting()
        refetch()
      })
      stopWaiting = () => {
        unsubscribe()
        stopWaiting = () => {}
      }
    }

    // 신호는 받는 중인 조회보다 뒤의 글이라 끊고 다시 받는다. 다시 받는 조회가 열림의 기다림도 채운다.
    // 읽지 못한 조회의 받기는 사용자의 다시 시도라 끊지 않는다 — 끊으면 오류로 되돌아가 다시 받지도 않는다
    async function refetchNow(): Promise<void> {
      stopWaiting()
      await queryClient.cancelQueries({ queryKey, predicate: hasReadableResponse })
      if (canRefetch()) refetch()
    }

    const disconnect = connectMessageSignals(workspaceId, {
      signal: session.signal,
      onSync: (cause) => (cause === 'opened' ? refetchAfterInFlight() : void refetchNow()),
    })
    return () => {
      live = false
      stopWaiting()
      disconnect()
    }
  }, [queryClient, workspaceId])
}
