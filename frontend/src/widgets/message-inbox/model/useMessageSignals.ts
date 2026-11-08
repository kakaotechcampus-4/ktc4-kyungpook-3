import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { connectMessageSignals, messageKeys } from '@/entities/message'
import { captureSessionScope } from '@/shared/api/sessionScope'

/**
 * 메시지 화면이 떠 있는 동안 대화 신호를 받아 그 공간의 메시지 조회를 다시 부른다. 끊겨도 화면에 표시하지 않는다.
 * 화면이 내려가거나 공간이 바뀌면 닫고, 연 세션이 끝나면 화면이 아직 떠 있어도 닫는다 — 다음 세션의 캐시에 닿지 않는다
 */
export function useMessageSignals(workspaceId: string): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const queryKey = messageKeys(workspaceId)
    return connectMessageSignals(workspaceId, {
      signal: captureSessionScope().signal,
      // 열렸을 때 받는 중인 조회는 거두지 않는다 — 첫 화면의 첫 조회를 끊어 다시 받으면 목록이 그만큼 늦게 뜬다.
      // 신호는 받는 중인 조회보다 뒤의 글이라 거두고 다시 받는다
      onSync: (cause) =>
        void queryClient.invalidateQueries(
          { queryKey },
          { cancelRefetch: cause === 'thread_updated' },
        ),
    })
  }, [queryClient, workspaceId])
}
