import { useQueries, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { integrationsQueryOptions } from '@/entities/integration'
import {
  finishMeeting,
  meetingDetailQueryOptions,
  meetingKeys,
  meetingListQueryOptions,
  useMeetingTrackerStore,
} from '@/entities/meeting'
import type { Meeting, TrackedMeeting } from '@/entities/meeting'
import { captureSession } from '@/entities/user'
import { fetchFresh } from '@/shared/api/fetchFresh'
import { workspaceKey } from '@/shared/api/queryKeys'
import { paths } from '@/shared/config/routes'
import { useLivePathname } from '@/shared/lib/live-pathname'
import { hasPendingLeave, useGuardedNavigate } from '@/shared/lib/unsaved-changes'
import { toast } from '@/shared/ui/toast'
import {
  PROCESSING_DONE_ACTION,
  PROCESSING_DONE_TITLE,
  PROCESSING_FAILED_TITLE,
  processingToastKey,
} from './notices'
import { pollInterval, trackerOutcome } from './trackerOutcome'

export interface ProcessingTracker {
  /** 정리 중 Notion 연결이 끊겨 실패한 공간. 앱이 재연결 모달(D-100)을 띄운다. 없으면 null */
  revokedWorkspaceId: string | null
  dismissRevoked: () => void
}

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

/**
 * 이 공간의 Notion 연결이 끊겼나. 실패를 본 **뒤의** 서버 상태로 판정한다.
 *
 * 연동 상태의 공유 Query 를 `fetchFresh` 로 묻는다. 실패 전에 출발해 진행 중이던 조회(설정의 포커스·무효화 재조회)의 답은
 * 쓰지 않고(U4 r3 M05), 그 조회를 구독하던 마지막 화면(설정)이 내려가 취소된 채 돌아온 이전 값(connected)은 답으로 치지 않고
 * 다시 묻는다(U4 r2 M03). 따로 요청을 보내 캐시에 쓰지 않는다 — 판정과 설정·업로드 화면이 같은 Query 의 값을 보고, 같은 key 의
 * 조회 순서는 TanStack Query 가 맡는다. 먼저 출발한 판정 조회의 이전 답이 나중 조회의 끊김을 덮지 못한다 (U4 r4 M06)
 */
async function isNotionRevoked(queryClient: QueryClient, workspaceId: string): Promise<boolean> {
  const latest = await fetchFresh(queryClient, integrationsQueryOptions(workspaceId))
  return latest.notion.status === 'revoked'
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
 * - 등록된 회의마다 상세를 3초 간격으로 polling 한다. 정리 중일 때만이다 — 끝났거나(완료·실패) 볼 수 없게 되면(403·404) 멈춘다.
 *   일시적 조회 실패(네트워크)는 정리 실패가 아니다. 그대로 지켜보고, 창 포커스·온라인 복귀 때 바로 다시 묻는다 (U4-8).
 * - 끝난 회의는 `finishMeeting` 이 처음 끝냈을 때만 알린다 — 재렌더·StrictMode·재발견·화면 이동에도 회의마다 한 번이다.
 * - 완료: 관련 캐시를 무효화하고 `회의 정리가 끝났어요` + `회의록 보기` 토스트(D-095).
 * - 실패: 목록 캐시에서 빼고(D-093) 연동 상태를 다시 물어 `revoked` 면 재연결 모달(D-100), 아니면 재업로드 토스트(D-092).
 *   실패 회의의 결과·원본을 다시 쓰는 길은 없다 — 다시 올리기만 안내한다 (D-091, D-099).
 * - 화면 이동은 **그 회의의 처리 화면을 보고 있을 때만** 한다(완료 → 회의록, 실패 → 회의록 목록). 다른 화면·공간의 사용자는
 *   그대로 둔다. 이탈 확인을 고르는 중이면 끼어들지 않고, 옮길 때는 앱 안 이동의 관문(useGuardedNavigate)을 탄다.
 *   「보고 있나」는 그려진 경로가 아니라 라우터 기록의 지금 경로로 본다 — 사용자가 이미 누른 이동이 지연 로드 화면을
 *   기다리는 중이면 처리 화면이 아직 그려져 있어도 떠난 것이다 (U4 r1 M01, useLivePathname).
 * - 알림·모달·이동은 그 일을 시작한 세션이 아직 이어질 때만 한다. 로그아웃 뒤에 연동 재조회가 끝나거나 만료로 401 이 와도
 *   실패로 보지 않고, 세션 세대가 바뀐 것을 보고 버린다 (U4 r1 M02, captureSession).
 * - 끊김 판정의 연동 재조회는 공유 Query 를 `fetchFresh` 로 묻는다. 실패 전에 출발한 조회의 답, 다른 화면이 구독을 거둬
 *   취소된 채 돌아온 이전 값(connected)으로 판정하지 않는다 (U4 r2 M03, r3 M05, isNotionRevoked). 캐시에 쓰는 길은 그 Query
 *   하나라 오래된 답이 더 새 끊김을 덮지 못한다 (U4 r4 M06). 끝난 세션의 조회는 세션 정리가 거두고 그 401 은 새 세션을
 *   끝내지 않는다 (U4 r3 M04).
 *
 * 추적 대상은 ID 뿐이다(store). 상태·진행은 상세 Query 캐시가 갖고, 처리 화면이 같은 캐시를 읽는다 (G5).
 */
export function useProcessingTracker(): ProcessingTracker {
  const queryClient = useQueryClient()
  const tracked = useMeetingTrackerStore((state) => state.meetings)
  const navigate = useGuardedNavigate()
  const { pathname } = useLocation()
  const livePathname = useLivePathname()
  // 늦게 끝난 비동기 처리(연동 재조회)와 토스트 액션이 지금 그려진 위치·관문을 쓰도록 최신 값을 둔다
  const latest = useRef({ navigate, pathname })
  useLayoutEffect(() => {
    latest.current = { navigate, pathname }
  }, [navigate, pathname])
  const [revokedWorkspaceId, setRevokedWorkspaceId] = useState<string | null>(null)

  const results = useQueries({
    queries: tracked.map((meeting) => ({
      ...meetingDetailQueryOptions(meeting.workspaceId, meeting.meetingId),
      refetchInterval: ({ state }: { state: { data?: Meeting; error: unknown } }) =>
        pollInterval(meeting, state.data, state.error),
      // 30초 최신 시간과 무관하게 돌아오면 바로 다시 묻는다 — 끊긴 사이에 끝났을 수 있다
      refetchOnWindowFocus: 'always' as const,
      refetchOnReconnect: 'always' as const,
    })),
  })

  /**
   * 그 회의의 처리 화면을 보고 있으면 옮긴다. 「보고 있다」는 처리 화면이 그려져 있고(커밋된 경로) 사용자가 다른 곳으로
   * 가는 중도 아니다(기록의 지금 경로)는 뜻이다. 커밋된 경로만으로는 진행 중인 사용자 이동을 모르고, 기록만으로는
   * 처리 화면으로 **가는 중**인 사람도 보고 있는 것으로 친다 — 그 사람은 도착해서 끝난 처리 화면(회의록 보기)을 본다.
   * 이탈 확인을 고르는 중이어도 그대로 둔다
   */
  const leaveProcessingScreen = useCallback(
    (meeting: TrackedMeeting, to: string) => {
      if (hasPendingLeave()) return
      const screen = paths.meetingProcessing(meeting.workspaceId, meeting.meetingId)
      const { pathname: shown, navigate: go } = latest.current
      if (shown !== screen || livePathname() !== screen) return
      go(to, { replace: true })
    },
    [livePathname],
  )

  const onDone = useCallback(
    (meeting: TrackedMeeting) => {
      const { workspaceId, meetingId } = meeting
      const isCurrentSession = captureSession()
      invalidateFinished(queryClient, meeting)
      toast.show({
        key: processingToastKey('done', workspaceId, meetingId),
        title: PROCESSING_DONE_TITLE,
        action: {
          label: PROCESSING_DONE_ACTION,
          // 세션이 끝나면 토스트도 비워지지만, 누르는 것과 정리가 겹쳐도 다음 세션으로 옮기지 않는다
          onClick: () => {
            if (isCurrentSession()) latest.current.navigate(paths.meetings(workspaceId, meetingId))
          },
        },
      })
      leaveProcessingScreen(meeting, paths.meetings(workspaceId, meetingId))
    },
    [leaveProcessingScreen, queryClient],
  )

  const onFailed = useCallback(
    async (meeting: TrackedMeeting) => {
      const { workspaceId, meetingId } = meeting
      const isCurrentSession = captureSession()
      // 실패 회의는 목록에 없다 (D-093). 서버 목록을 기다리지 않고 캐시에서 먼저 뺀다
      queryClient.setQueryData(meetingListQueryOptions(workspaceId).queryKey, (list) =>
        list?.filter(({ id }) => id !== meetingId),
      )
      invalidateMeetings(queryClient, meeting)
      // 끊김으로 실패했는지는 연동 상태를 새로 물어 안다 — failed_stage 는 자유 문자열이다 (계약 §4.7-3)
      let revoked = false
      try {
        revoked = await isNotionRevoked(queryClient, workspaceId)
      } catch {
        // 확인하지 못했다 — 같은 세션이면 일반 실패 안내로 간다(아래)
      }
      // 기다리는 동안 세션이 끝났다(로그아웃했거나 조회가 401). 그 세션의 알림·모달·이동은 없다.
      // 컴포넌트의 mounted 로는 못 막는다 — 로그인 이동은 transition 이라 이 추적기가 아직 마운트돼 있다
      if (!isCurrentSession()) return
      if (revoked) setRevokedWorkspaceId(workspaceId)
      else
        toast.show({
          key: processingToastKey('failed', workspaceId, meetingId),
          title: PROCESSING_FAILED_TITLE,
        })
      leaveProcessingScreen(meeting, paths.meetings(workspaceId))
    },
    [leaveProcessingScreen, queryClient],
  )

  useEffect(() => {
    tracked.forEach((meeting, index) => {
      const result = results[index]
      if (result === undefined) return
      const outcome = trackerOutcome(meeting, result.data, result.error)
      if (outcome === 'processing') return
      // 이 호출이 처음 끝냈을 때만 알린다. 볼 수 없게 된 회의(lost)는 알리지 않고 그만 본다
      if (!finishMeeting(meeting)) return
      if (outcome === 'done') onDone(meeting)
      else if (outcome === 'failed') void onFailed(meeting)
    })
  }, [tracked, results, onDone, onFailed])

  return {
    revokedWorkspaceId,
    dismissRevoked: useCallback(() => setRevokedWorkspaceId(null), []),
  }
}
