import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { findUploadBlockingMeeting, meetingListQueryOptions } from '@/entities/meeting'

/**
 * 업로드 화면에 들어올 때의 판정 (U3-1).
 * - `processing`: 공간에 업로드를 막는 정리 중 회의가 있다 — 그 처리 화면으로 `replace` 이동 (D-088~D-090).
 *   채팅 회의는 막지 않는다 (#450)
 * - `error`: 확인하지 못했다. 다시 시도를 준다
 *
 * Notion 연결은 보지 않는다. Notion 은 선택 기능이라 연결하지 않아도 회의를 올리고 정리한다 (D-182)
 */
export type UploadEntry =
  | { kind: 'checking' }
  | { kind: 'processing'; meetingId: string }
  | { kind: 'error'; error: unknown; retry: () => void }
  | { kind: 'ready' }

/**
 * 진입 판정. 이 화면에 들어온 뒤 새로 받은 회의 목록으로만 판정한다 — 30초 캐시의 처리 상태를 믿지 않는다.
 * `ready` 가 되면 그대로 둔다. 폼을 쓰는 동안의 재조회(창 포커스 등)가 화면을 갑자기 바꾸지 않는다 —
 * 그 사이에 생긴 정리는 업로드 응답(409)이 알린다 (U3-10).
 */
export function useUploadEntry(workspaceId: string): UploadEntry {
  const [settled, setSettled] = useState(false)
  // staleTime 0 — 이 화면의 구독만 캐시를 늘 낡은 것으로 본다. 마운트 때 반드시 새로 받는다
  const meetings = useQuery({ ...meetingListQueryOptions(workspaceId), staleTime: 0 })
  const meetingsChecked = meetings.isFetchedAfterMount && !meetings.isFetching

  if (settled) return { kind: 'ready' }
  if (meetings.isError && !meetings.isFetching)
    return { kind: 'error', error: meetings.error, retry: () => void meetings.refetch() }
  if (!meetingsChecked || meetings.data === undefined) return { kind: 'checking' }
  const processing = findUploadBlockingMeeting(meetings.data)
  if (processing !== null) return { kind: 'processing', meetingId: processing.id }
  // 렌더 중 상태 갱신은 같은 컴포넌트에서 한 번만 일어난다 — 다음 렌더부터 settled 다
  setSettled(true)
  return { kind: 'ready' }
}
