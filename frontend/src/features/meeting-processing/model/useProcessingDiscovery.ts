import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { meetingListQueryOptions, trackMeeting } from '@/entities/meeting'

/**
 * 지금 공간의 회의 목록에서 정리 중 회의를 찾아 추적에 등록한다 (U4-1, U4-2).
 * 지금 공간 하나만 본다 — 다른 공간 목록을 돌며 조회하지 않는다. 다른 공간에서 시작한 추적은
 * 등록된 채 끝날 때까지 이어지고(추적기는 공간 밖에 있다), 새로고침하면 그때 보는 공간의 목록으로 다시 찾는다.
 * 목록은 회의록 화면과 같은 캐시(30초)를 쓴다. 끝낸 회의는 낡은 목록이 정리 중으로 보여도 다시 등록되지 않는다.
 */
export function useProcessingDiscovery(workspaceId: string): void {
  const { data } = useQuery(meetingListQueryOptions(workspaceId))
  useEffect(() => {
    for (const meeting of data ?? [])
      if (meeting.status === 'processing') trackMeeting({ workspaceId, meetingId: meeting.id })
  }, [data, workspaceId])
}
