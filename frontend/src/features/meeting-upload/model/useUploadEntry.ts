import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { integrationsQueryOptions } from '@/entities/integration'
import type { DisconnectedStatus } from '@/entities/integration'
import { findProcessingMeeting, meetingListQueryOptions } from '@/entities/meeting'

/** Notion 이 연결돼 있지 않은 까닭. 모달이 둘이다 — 미연결(D-097)과 끊김(D-100) */
export type NotionBlockReason = DisconnectedStatus

/**
 * 업로드 화면에 들어올 때의 판정 (U3-1).
 * - `processing`: 공간에 정리 중인 회의가 있다 — 그 처리 화면으로 `replace` 이동 (D-088~D-090)
 * - `blocked`: Notion 이 연결돼 있지 않다 — 차단 모달 (D-096, D-097, D-100)
 * - `error`: 확인하지 못했다. 미연결로 보지 않고 다시 시도를 준다
 */
export type UploadEntry =
  | { kind: 'checking' }
  | { kind: 'processing'; meetingId: string }
  | { kind: 'blocked'; reason: NotionBlockReason }
  | { kind: 'error'; error: unknown; retry: () => void }
  | { kind: 'ready' }

/**
 * 진입 판정. 회의 목록을 먼저 보고 정리 중 회의가 없을 때만 연동 상태를 본다.
 * 둘 다 이 화면에 들어온 뒤 새로 받은 값으로만 판정한다 — 30초 캐시의 처리 상태를 믿지 않는다.
 * `ready` 가 되면 그대로 둔다. 폼을 쓰는 동안의 재조회(창 포커스 등)가 화면을 갑자기 바꾸지 않는다 —
 * 그 사이에 생긴 정리·연결 끊김은 업로드 응답(409)이 알린다 (U3-10).
 */
export function useUploadEntry(workspaceId: string): UploadEntry {
  const [settled, setSettled] = useState(false)
  // staleTime 0 — 이 화면의 구독만 캐시를 늘 낡은 것으로 본다. 마운트 때와, 연동 조회가 켜질 때 반드시 새로 받는다.
  // (refetchOnMount 만으로는 부족하다. 연동 조회는 꺼진 채 마운트되므로, 30초 안에 받아 둔 캐시가 있으면 켜져도 받지 않는다)
  const meetings = useQuery({ ...meetingListQueryOptions(workspaceId), staleTime: 0 })
  const meetingsChecked = meetings.isFetchedAfterMount && !meetings.isFetching
  const processing =
    meetingsChecked && meetings.data !== undefined ? findProcessingMeeting(meetings.data) : null
  const integrations = useQuery({
    ...integrationsQueryOptions(workspaceId),
    staleTime: 0,
    enabled: meetingsChecked && !meetings.isError && processing === null,
  })
  const integrationsChecked = integrations.isFetchedAfterMount && !integrations.isFetching

  if (settled) return { kind: 'ready' }
  if (meetings.isError && !meetings.isFetching)
    return { kind: 'error', error: meetings.error, retry: () => void meetings.refetch() }
  if (!meetingsChecked) return { kind: 'checking' }
  if (processing !== null) return { kind: 'processing', meetingId: processing.id }
  if (integrations.isError && !integrations.isFetching)
    return { kind: 'error', error: integrations.error, retry: () => void integrations.refetch() }
  if (!integrationsChecked || integrations.data === undefined) return { kind: 'checking' }
  const { status } = integrations.data.notion
  if (status !== 'connected') return { kind: 'blocked', reason: status }
  // 렌더 중 상태 갱신은 같은 컴포넌트에서 한 번만 일어난다 — 다음 렌더부터 settled 다
  setSettled(true)
  return { kind: 'ready' }
}
