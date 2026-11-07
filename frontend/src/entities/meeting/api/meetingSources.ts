import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { MeetingSource } from '../model/types'
import { meetingListQueryOptions } from './meetingQueries'

/**
 * 회의의 출처(녹음·업로드·채팅). 상세 응답에 없어 목록 요약에서 읽는다 (#483).
 *
 * 찾는 회의가 받아 둔 목록에 없으면(목록을 받은 뒤 생긴 회의, 오래된 목록) 그 회의마다 한 번 목록을 새로 받는다 —
 * 목록 Query 는 30초 동안 새로 묻지 않아 기다리기만 하면 끝까지 모를 수 있다.
 * 모르는 동안(목록 대기, 새로 받는 중, 조회 실패, 새로 받아도 없음)은 null 이다. 단계 표시는 단계 수를 정하지 않는다 —
 * 녹음 단계로 짐작하면 채팅 회의가 세 단계로 보였다가 두 단계로 바뀐다
 */
export function useMeetingSources(
  workspaceId: string,
  meetingIds: readonly string[],
): (meetingId: string) => MeetingSource | null {
  const { data, isFetching, refetch } = useQuery(meetingListQueryOptions(workspaceId))
  const asked = useRef(new Set<string>())
  const wanted = meetingIds.join(',')

  useEffect(() => {
    if (data === undefined || isFetching || wanted === '') return
    const missing = wanted
      .split(',')
      .filter((id) => !data.some((meeting) => meeting.id === id))
      .map((id) => `${workspaceId}/${id}`)
      .filter((key) => !asked.current.has(key))
    if (missing.length === 0) return
    for (const key of missing) asked.current.add(key)
    void refetch()
  }, [data, isFetching, refetch, wanted, workspaceId])

  return (meetingId) => data?.find(({ id }) => id === meetingId)?.source ?? null
}
