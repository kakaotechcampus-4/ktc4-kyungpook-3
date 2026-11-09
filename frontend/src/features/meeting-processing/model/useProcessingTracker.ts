import { useQueries, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router'
import {
  finishMeeting,
  meetingDetailQueryOptions,
  meetingFailure,
  meetingKeys,
  meetingListQueryOptions,
  promptSpeakers,
  settleMeeting,
  useMeetingTrackerStore,
} from '@/entities/meeting'
import type { Meeting, TrackedMeeting } from '@/entities/meeting'
import { findMemberWorkspace, workspaceListQueryOptions } from '@/entities/workspace'
import { workspaceKey } from '@/shared/api/queryKeys'
import { paths } from '@/shared/config/routes'
import { useLivePathname } from '@/shared/lib/live-pathname'
import { hasPendingLeave, useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { pollInterval, refetchOnReturn, trackerOutcome } from './trackerOutcome'

/**
 * 끝난 회의 때문에 낡은 회의 캐시(목록·다른 회의 상세). 끝난 회의 자신의 상세는 방금 받은 끝 상태라 다시 받지 않는다 —
 * 무효화하면 아직 붙어 있는 추적 구독이 같은 상세를 한 번 더 묻는다
 */
function invalidateMeetings(queryClient: QueryClient, { workspaceId, meetingId }: TrackedMeeting) {
  const finishedKey = meetingDetailQueryOptions(workspaceId, meetingId).queryKey
  void queryClient.invalidateQueries({
    queryKey: meetingKeys(workspaceId),
    predicate: ({ queryKey }) =>
      !(
        queryKey.length === finishedKey.length &&
        queryKey.every((part, index) => part === finishedKey[index])
      ),
  })
}

/** 정리가 끝나 새로 생긴 것들 — 회의·회의록·추출·태스크·승인 (U4-5) */
function invalidateFinished(queryClient: QueryClient, meeting: TrackedMeeting): void {
  invalidateMeetings(queryClient, meeting)
  for (const scope of ['minutes', 'extractions', 'tasks', 'approvals'] as const)
    void queryClient.invalidateQueries({ queryKey: workspaceKey(meeting.workspaceId, scope) })
}

/**
 * 앱 수준 처리 추적기 (U4-1~U4-8). 인증된 앱 영역에 하나 둔다 — 화면·공간을 옮겨도 polling 이 이어진다.
 *
 * - 등록된 회의마다 상세를 3초 간격으로 polling 한다. 정리 중일 때만이다(화자 지정 대기는 30초) — 끝났거나(완료·실패) 볼 수 없게 되면(403·404) 멈춘다.
 *   일시적 조회 실패(네트워크)는 정리 실패가 아니다. 그대로 지켜보고, 창 포커스·온라인 복귀 때 바로 다시 묻는다 (U4-8).
 *   응답을 읽지 못했으면(`INVALID_RESPONSE`) polling·포커스·복귀 재조회를 모두 멈추고 끝내지도 않는다. 처리 화면의 다시 시도가
 *   성공하면 다시 지켜본다 (#348).
 * - 끝난 회의는 `finishMeeting` 이 처음 끝냈을 때만 알린다 — 재렌더·StrictMode·재발견·화면 이동에도 회의마다 한 번이다.
 * - 알림은 진행 토스트(ProcessingToast)가 그린다. 추적기는 끝난 결과(`settleMeeting`)만 적고, 정리 중·대기는 토스트가
 *   같은 상세 캐시를 읽는다 — 같은 회의의 신호는 토스트 하나다 (#424).
 * - 완료: 관련 캐시를 무효화하고 완료 결과를 적는다(`회의 정리가 끝났어요` + `회의록 보기`, D-095).
 * - 실패: 화자 지정 만료는 목록에 남기고 상세로 잇는다. 그 외 실패는 목록에서 뺀다.
 *   실패 결과는 failed_stage 그대로 적는다 — 알 수 없는 값도 일반 실패(D-092)다. Notion 연결 상태는 묻지 않는다.
 *   서버의 정리 실패는 AI 단계와 멈춤 정리에서만 오고 Notion 때문에 실패하지 않는다 (D-182). 팀원에게 실패를 보이지
 *   않는 것은 토스트가 정한다. 실패 회의의 결과·원본을 다시 쓰는 길은 없다 — 다시 올리기만 안내한다 (D-091).
 * - 화면 이동은 **그 회의의 처리 화면을 보고 있을 때만** 한다(완료 → 회의록, 실패 → 회의록 목록). 다른 화면·공간의 사용자는
 *   그대로 둔다. 이탈 확인을 고르는 중이면 끼어들지 않고, 옮길 때는 앱 안 이동의 관문(useGuardedNavigate)을 탄다.
 *   「보고 있나」는 그려진 경로가 아니라 라우터 기록의 지금 경로로 본다 — 사용자가 이미 누른 이동이 지연 로드 화면을
 *   기다리는 중이면 처리 화면이 아직 그려져 있어도 떠난 것이다 (U4 r1 M01, useLivePathname).
 * - 화자 지정 대기(#256): 처음 보였을 때 목록 캐시를 대기로 바꾼다 — 팀원 목록에도 `화자 지정 필요` 가 보여야 한다.
 *   회의마다 세션당 한 번, PM 이 그 회의의 처리 화면을 보고 있으면 지정 화면으로 옮긴다. 다른 화면의 PM 에게는 진행
 *   토스트가 화자 지정 모양으로 바뀐다. 팀원은 옮기지 않는다 — 처리 화면이 「PM이 지정하고 있어요」를 보인다.
 *   대기 중에는 30초 간격으로 지켜보고, 지정 뒤 끝나면 위의 완료·실패 처리가 그대로 돈다.
 *
 * 추적 대상은 ID 뿐이다(store). 상태·진행은 상세 Query 캐시가 갖고, 처리 화면이 같은 캐시를 읽는다 (G5).
 */
export function useProcessingTracker(): void {
  const queryClient = useQueryClient()
  const tracked = useMeetingTrackerStore((state) => state.meetings)
  const navigate = useGuardedNavigate()
  const { pathname } = useLocation()
  const livePathname = useLivePathname()
  // 이동 판단이 지금 그려진 위치·관문을 쓰도록 최신 값을 둔다 — 위치가 바뀌어도 추적 효과를 다시 돌리지 않는다
  const latest = useRef({ navigate, pathname })
  useLayoutEffect(() => {
    latest.current = { navigate, pathname }
  }, [navigate, pathname])

  const results = useQueries({
    queries: tracked.map((meeting) => ({
      ...meetingDetailQueryOptions(meeting.workspaceId, meeting.meetingId),
      refetchInterval: ({ state }: { state: { data?: Meeting; error: unknown } }) =>
        pollInterval(state.data, state.error),
      // 30초 최신 시간과 무관하게 돌아오면 바로 다시 묻는다 — 끊긴 사이에 끝났을 수 있다. 읽지 못한 응답은 묻지 않는다
      refetchOnWindowFocus: refetchOnReturn,
      refetchOnReconnect: refetchOnReturn,
    })),
  })

  /**
   * 그 회의의 처리 화면을 보고 있으면 옮긴다. 「보고 있다」는 처리 화면이 그려져 있고(커밋된 경로) 사용자가 다른 곳으로
   * 가는 중도 아니다(기록의 지금 경로)는 뜻이다. 커밋된 경로만으로는 진행 중인 사용자 이동을 모르고, 기록만으로는
   * 처리 화면으로 **가는 중**인 사람도 보고 있는 것으로 친다 — 그 사람은 도착해서 끝난 처리 화면(회의록 보기)을 본다.
   * 이탈 확인을 고르는 중이어도 그대로 둔다
   */
  const leaveProcessingScreen = useCallback(
    (meeting: TrackedMeeting, to: string): boolean => {
      if (hasPendingLeave()) return false
      const screen = paths.meetingProcessing(meeting.workspaceId, meeting.meetingId)
      const { pathname: shown, navigate: go } = latest.current
      if (shown !== screen || livePathname() !== screen) return false
      go(to, { replace: true })
      return true
    },
    [livePathname],
  )

  const onAwaitingSpeakers = useCallback(
    (meeting: TrackedMeeting) => {
      const { workspaceId, meetingId } = meeting
      queryClient.setQueryData(meetingListQueryOptions(workspaceId).queryKey, (list) =>
        list?.map((item) =>
          item.id === meetingId ? { ...item, status: 'awaiting_speakers' as const } : item,
        ),
      )
      invalidateMeetings(queryClient, meeting)
      const workspaces = queryClient.getQueryData(workspaceListQueryOptions().queryKey) ?? []
      if (findMemberWorkspace(workspaces, workspaceId)?.role !== 'pm') return
      leaveProcessingScreen(meeting, paths.meetingSpeakers(workspaceId, meetingId))
    },
    [leaveProcessingScreen, queryClient],
  )

  const onDone = useCallback(
    (meeting: TrackedMeeting, detail: Meeting) => {
      invalidateFinished(queryClient, meeting)
      settleMeeting({ ...meeting, title: detail.title, outcome: 'done' })
      leaveProcessingScreen(meeting, paths.meetings(meeting.workspaceId, meeting.meetingId))
    },
    [leaveProcessingScreen, queryClient],
  )

  const onFailed = useCallback(
    (meeting: TrackedMeeting, detail: Meeting) => {
      const { workspaceId, meetingId } = meeting
      const { failedStage } = detail
      const failure = meetingFailure(failedStage)
      // 만료 이력은 유지하고, 나머지 실패는 기존 정책대로 목록에서 뺀다.
      queryClient.setQueryData(meetingListQueryOptions(workspaceId).queryKey, (list) =>
        failure.kind === 'expired'
          ? list?.map((item) =>
              item.id === meetingId ? { ...item, status: 'failed' as const, failedStage } : item,
            )
          : list?.filter(({ id }) => id !== meetingId),
      )
      invalidateMeetings(queryClient, meeting)
      settleMeeting({ ...meeting, title: detail.title, outcome: 'failed', failedStage })
      leaveProcessingScreen(
        meeting,
        paths.meetings(workspaceId, failure.kind === 'expired' ? meetingId : undefined),
      )
    },
    [leaveProcessingScreen, queryClient],
  )

  useEffect(() => {
    tracked.forEach((meeting, index) => {
      const result = results[index]
      if (result === undefined) return
      const outcome = trackerOutcome(result.data, result.error)
      if (outcome === 'awaiting_speakers') {
        if (promptSpeakers(meeting)) onAwaitingSpeakers(meeting)
        return
      }
      if (outcome === 'processing' || outcome === 'invalid') return
      // 이 호출이 처음 끝냈을 때만 알린다. 볼 수 없게 된 회의(lost)는 알리지 않고 그만 본다
      if (!finishMeeting(meeting) || result.data === undefined) return
      if (outcome === 'done') onDone(meeting, result.data)
      else if (outcome === 'failed') onFailed(meeting, result.data)
    })
  }, [tracked, results, onDone, onFailed, onAwaitingSpeakers])
}
