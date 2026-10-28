import { useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { useMemo } from 'react'
import { pendingApprovalListQueryOptions } from '@/entities/approval'
import type { Approval } from '@/entities/approval'
import { extractionQueryOptions } from '@/entities/extraction'
import type { Extraction, ExtractionItem } from '@/entities/extraction'
import { integrationsQueryOptions } from '@/entities/integration'
import type { Integrations } from '@/entities/integration'
import { meetingDetailQueryOptions, meetingListQueryOptions } from '@/entities/meeting'
import type { Meeting, MeetingSummary } from '@/entities/meeting'
import { memberListQueryOptions } from '@/entities/member'
import type { Member } from '@/entities/member'
import { taskListQueryOptions } from '@/entities/task'
import type { Task } from '@/entities/task'
import { NOTION_SYNC_POLL_MS } from '@/features/task-notion-sync'
import { createClientError, CLIENT_ERROR_CODES } from '@/shared/api/errors'
import { hasPendingSync, latestDoneMeeting, recentAutoItems } from '../lib/dashboard'
import { queryView } from '../lib/queryView'

/** 데이터는 있으나 마지막 재조회가 실패했다 (E-02). 다시 시도하는 중이면 `retrying` 이다 */
export interface RefreshFailure {
  error: unknown
  retry: () => void
  retrying: boolean
}

/**
 * 한 조회의 화면 상태. 로딩·실패·데이터를 구분한다 — 실패를 빈 데이터나 0 으로 그리지 않는다.
 * `ready` 의 `refreshFailed` 는 갱신 실패다. 기존 데이터를 그대로 그리고 갱신 실패만 따로 알린다
 */
export type Loadable<T> =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'ready'; data: T; refreshFailed?: RefreshFailure }

function loadable<T>(query: UseQueryResult<T>): Loadable<T> {
  // 진행 중인 조회가 있으면 새로 보내지 않고 그 조회를 기다린다 — 같은 틱의 두 번째 누름도 요청을 늘리지 않는다
  const retry = () => {
    void query.refetch({ cancelRefetch: false })
  }
  switch (queryView(query)) {
    case 'ready':
      return { status: 'ready', data: query.data as T }
    case 'refreshFailed':
      return {
        status: 'ready',
        data: query.data as T,
        refreshFailed: { error: query.error, retry, retrying: query.isFetching },
      }
    case 'error':
      return { status: 'error', error: query.error, retry }
    case 'loading':
      return { status: 'loading' }
  }
}

/**
 * 한 영역이 쓰는 조회들의 갱신 실패를 하나로 묶는다 (E-02 후속). 판정은 각 `loadable` 이 `queryView` 로 정한 `refreshFailed` 뿐이다.
 * 하나라도 갱신에 실패했으면 안내 하나를 돌려준다. 다시 시도는 실패한 조회를 모두 다시 부르고,
 * 묶인 조회 중 하나라도 다시 받는 중이면 `retrying` 이다. 실패가 없으면 undefined
 */
export function refreshFailure(
  ...states: (Loadable<unknown> | null | undefined)[]
): RefreshFailure | undefined {
  const failures = states.flatMap((state) =>
    state?.status === 'ready' && state.refreshFailed !== undefined ? [state.refreshFailed] : [],
  )
  if (failures.length === 0) return undefined
  return {
    error: failures[0].error,
    retry: () => {
      for (const failure of failures) failure.retry()
    },
    retrying: failures.some(({ retrying }) => retrying),
  }
}

/** 최신 완료 회의와 그 추출. 회의 목록 → 회의 상세 → 추출 순서로만 알 수 있다 */
export interface RecentSource {
  meeting: MeetingSummary
  /** 회의 상세. 추출 ID 가 여기에만 있다 */
  detail: Loadable<Meeting>
  /** 추출. 상세에 추출 ID 가 없는 회의면 `ready` 이고 null 이다 */
  extraction: Loadable<Extraction | null>
}

export interface DashboardData {
  tasks: Loadable<Task[]>
  /** 대기 승인. 일반 팀원이면 null — 조회하지 않는다 (D-104, D-163) */
  approvals: Loadable<Approval[]> | null
  members: Loadable<Member[]>
  integrations: Loadable<Integrations>
  meetings: Loadable<MeetingSummary[]>
  /** 정리 끝난 회의가 없으면 null. 회의 목록을 아직 모르면 undefined */
  recent: RecentSource | null | undefined
  /** 최근 반영으로 보일 auto 항목. 추출을 아직 모르면 빈 배열 */
  autoItems: ExtractionItem[]
}

/**
 * 대시보드가 쓰는 조회 (M7 계획 §1). 새 API 없이 기존 Query 를 그대로 재사용한다 — key 가 공간별이라 공간을 바꿔도 섞이지 않는다.
 * - 태스크·대기 승인(PM)·팀원·연동·회의 목록은 서로 기다리지 않고 함께 시작한다
 * - 최신 완료 회의의 상세와 추출은 앞 조회가 끝나야 ID 를 안다
 * - 최근 반영에 반영 대기(`pending`) 태스크가 있으면 태스크 목록을 3초마다 다시 받는다. 모두 끝나거나 조회가 실패하면 멈추고,
 *   화면을 떠나면 이 관찰자와 함께 사라진다 (M6 `notionSyncRefetchInterval` 과 같은 규칙). 실패 판정은 화면과 같은 `queryView` 다 —
 *   멈춘 동안 화면은 갱신 실패와 다시 시도를 보이고, 다시 시도가 성공하면 polling 이 다시 돈다
 */
export function useDashboardData(workspaceId: string, isPm: boolean): DashboardData {
  const approvals = useQuery({ ...pendingApprovalListQueryOptions(workspaceId), enabled: isPm })
  const members = useQuery(memberListQueryOptions(workspaceId))
  const integrations = useQuery(integrationsQueryOptions(workspaceId))
  const meetings = useQuery(meetingListQueryOptions(workspaceId))

  const latest = meetings.data === undefined ? undefined : latestDoneMeeting(meetings.data)
  const detail = useQuery({
    ...meetingDetailQueryOptions(workspaceId, latest?.id ?? ''),
    enabled: latest !== undefined && latest !== null,
  })
  // 상세 경로에 공간이 없다. 응답의 공간이 지금 공간이 아니면 그 추출을 이 화면에 쓰지 않는다
  const detailMismatch = detail.data !== undefined && detail.data.workspaceId !== workspaceId
  const extractionId = detailMismatch ? null : (detail.data?.extractionId ?? null)
  const extraction = useQuery({
    ...extractionQueryOptions(workspaceId, extractionId ?? ''),
    enabled: extractionId !== null,
  })
  const autoItems = useMemo(
    () => (extraction.data === undefined ? [] : recentAutoItems(extraction.data.items)),
    [extraction.data],
  )

  const tasks = useQuery({
    ...taskListQueryOptions(workspaceId),
    refetchInterval: (query) =>
      queryView(query.state) === 'ready' && hasPendingSync(autoItems, query.state.data)
        ? NOTION_SYNC_POLL_MS
        : false,
  })

  let recent: RecentSource | null | undefined
  if (latest === undefined || latest === null) recent = latest
  else {
    const detailState: Loadable<Meeting> = detailMismatch
      ? {
          status: 'error',
          error: createClientError(CLIENT_ERROR_CODES.INVALID_RESPONSE),
          retry: () => {
            void detail.refetch()
          },
        }
      : loadable(detail)
    recent = {
      meeting: latest,
      detail: detailState,
      extraction:
        detailState.status !== 'ready'
          ? detailState
          : detailState.data.extractionId === null
            ? { status: 'ready', data: null }
            : loadable(extraction),
    }
  }

  return {
    tasks: loadable(tasks),
    approvals: isPm ? loadable(approvals) : null,
    members: loadable(members),
    integrations: loadable(integrations),
    meetings: loadable(meetings),
    recent,
    autoItems,
  }
}
