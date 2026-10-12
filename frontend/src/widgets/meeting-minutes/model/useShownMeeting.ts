import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { meetingDetailQueryOptions } from '@/entities/meeting'
import { minutesQueryOptions } from '@/entities/minutes'

/**
 * 회의를 바꾼 뒤 새 회의록이 오기를 기다리며 이전 회의록을 들고 있는 최대 시간.
 * 이 안에 답이 오면 스켈레톤 없이 바로 바뀌고, 넘기면 스켈레톤을 그린다 — docs/impl-decision/2026-10-06-minutes-skeleton-and-selection.md
 */
export const MINUTES_HOLD_MS = 250

/**
 * 들고 있는 이전 본문을 흐리게 바꾸기까지 기다리는 시간. 이 안에 답이 오면 흐림 없이 바로 바뀐다 —
 * 짧은 답마다 본문이 흐렸다 돌아오면 그것이 다시 깜빡임이다. 100ms 는 바뀜을 즉시로 느끼는 한계로 흔히 쓰는 값이다.
 * 흐림은 이 지연 뒤 한 번에 바뀐다(전환 없음) — docs/impl-decision/2026-10-06-minutes-skeleton-and-selection.md 개정 절
 */
export const MINUTES_DIM_DELAY_MS = 100

/**
 * 회의를 바꾼 뒤 본문 뼈대를 그렸다면 그 뼈대를 적어도 이만큼 둔다. 답이 들고 있기 상한(MINUTES_HOLD_MS)을 막 넘겨 오면
 * 뼈대가 수십 ms 만 보였다 사라졌다 — 그것이 번쩍임이다(UX1-N03). 상한 근처의 답은 미리 알 수 없어 뼈대를 건너뛸 수 없으므로,
 * 한 번 보인 뼈대는 하나의 상태로 읽힐 만큼 둔다. 300ms 는 즉시로 느끼는 한계(100ms, MINUTES_DIM_DELAY_MS)의 세 배라
 * 깜빡임이 아닌 기다림으로 보이고, 들고 있기와 합쳐도 550ms 라 흐름이 끊긴다고 느끼는 1초보다 짧다.
 * 첫 진입(바꾼 적 없음)에는 두지 않는다 — 라우트 뼈대부터 이어지는 같은 뼈대라 번쩍일 것이 없다.
 * docs/impl-decision/2026-10-06-minutes-skeleton-and-selection.md 개정 3
 */
export const MINUTES_SKELETON_MIN_MS = 300

/**
 * 새 회의의 회의록을 그릴 수 있나 — 화면이 그릴 조회가 답(또는 실패)을 받았다.
 * MinutesDetail 과 같은 Query 를 같은 조건으로 본다. 상세의 `workspaceId` 가 URL 공간과 같고 정리가 끝난 회의일 때만
 * 회의록 본문을 부른다 (U5-4). 같은 key 라 MinutesDetail 이 마운트되면 이 조회에 합쳐지고 따로 요청하지 않는다.
 */
function useMinutesSettled(workspaceId: string, meetingId: string | null): boolean {
  const detail = useQuery({
    ...meetingDetailQueryOptions(workspaceId, meetingId ?? ''),
    enabled: meetingId !== null,
  })
  const meeting =
    detail.data !== undefined && detail.data.workspaceId === workspaceId ? detail.data : null
  const needsMinutes = meeting !== null && meeting.status === 'done'
  const minutes = useQuery({
    ...minutesQueryOptions(workspaceId, meeting?.id ?? ''),
    enabled: needsMinutes,
  })
  if (detail.data === undefined) return detail.error !== null
  if (!needsMinutes) return true
  return minutes.data !== undefined || minutes.error !== null
}

/** 화면이 그릴 회의와 그 상태 — useSelectionTimeline · useShownMeeting 이 돌려준다 */
export interface ShownMeeting {
  /** 오른쪽 본문이 그릴 회의 */
  shownId: string | null
  /** 고른 회의의 답을 기다리며 이전 회의(`shownId`)의 본문을 들고 있다 */
  holding: boolean
  /** 그리던 회의를 다른 회의로 바꾼 적이 있다 */
  switched: boolean
  /** 그린 본문 뼈대를 MINUTES_SKELETON_MIN_MS 가 차기 전이라 답이 와도 뼈대를 둔다 */
  keepSkeleton: boolean
}

/**
 * 회의를 바꿀 때의 시간 규칙 — 조회와 상관없이 `settled`(고른 회의를 그릴 수 있나)만 보고 정한다. 그래서 가짜 타이머로
 * 경계 전후를 그대로 검사할 수 있다(useShownMeeting.test.ts).
 *
 * - URL 의 회의가 바뀌었는데 아직 그릴 수 없으면 이전 회의를 `MINUTES_HOLD_MS` 동안만 들고 있는다(`holding`). 회의를 연달아 바꿔도
 *   처음 바꾼 때부터 잰다. 처음 고를 때(이전 회의가 없을 때)와 `canHold` 가 아닐 때(머리를 바꿀 목록 요약이 없다)는 들고 있지 않는다.
 * - 들고 있지 않게 되면 고른 회의로 넘어간다. 그때도 그릴 수 없으면 본문 뼈대가 보인다 — 그 뼈대는 `MINUTES_SKELETON_MIN_MS` 동안
 *   둔다(`keepSkeleton`). 그 사이 다른 회의를 고르면 뼈대 위에서 들고 있다가 넘어간다 — 그동안 받은 이전 회의 본문을 처음 보이지 않는다.
 * - `switched` 는 그리던 회의를 다른 회의로 바꾼 적이 있다는 뜻이다. 그 뒤로는 기다리는 본문 뼈대의 머리도 고른 회의의 요약으로
 *   그린다 — 들고 있다가 넘어갈 때 머리가 요약 → 뼈대 → 회의록으로 깜빡이지 않는다. 첫 진입은 이전 회의가 없어 오인될 것이 없고,
 *   머리 뼈대가 라우트 스켈레톤과 같은 모양이라 그대로 둔다.
 */
export function useSelectionTimeline(
  meetingId: string | null,
  settled: boolean,
  canHold: boolean,
): ShownMeeting {
  const [shownId, setShownId] = useState(meetingId)
  const [expired, setExpired] = useState(false)
  const [switched, setSwitched] = useState(false)
  // 뼈대를 최소 시간 동안 두는 회의. 시간이 차면 null
  const [skeletonFor, setSkeletonFor] = useState<string | null>(null)
  const waiting =
    canHold && shownId !== null && meetingId !== null && shownId !== meetingId && !settled
  const holding = waiting && !expired

  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => setExpired(true), MINUTES_HOLD_MS)
    return () => clearTimeout(timer)
  }, [waiting])

  useEffect(() => {
    if (skeletonFor === null) return
    const timer = setTimeout(() => setSkeletonFor(null), MINUTES_SKELETON_MIN_MS)
    return () => clearTimeout(timer)
  }, [skeletonFor])

  // 렌더 중 상태 맞추기 — 들고 있을 까닭이 없으면 바로 URL 의 회의로 넘어간다
  if (shownId !== meetingId && !holding) {
    setShownId(meetingId)
    setExpired(false)
    if (shownId !== null) {
      setSwitched(true)
      // 넘어가는 이 렌더에 고른 회의를 그릴 수 없으면 뼈대가 보인다 — 그때부터 최소 시간을 잰다
      setSkeletonFor(meetingId !== null && !settled ? meetingId : null)
    }
  }

  const current = holding ? shownId : meetingId
  return {
    shownId: current,
    holding,
    switched,
    keepSkeleton: current !== null && skeletonFor === current,
  }
}

/**
 * 오른쪽 본문이 그릴 회의. 고른 회의를 그릴 수 있는지(useMinutesSettled)를 시간 규칙(useSelectionTimeline)에 넘긴다.
 * 빠른 답(미리 받았거나 짧은 응답)은 스켈레톤을 거치지 않고 바로 바뀐다. 들고 있는 동안 화면은 본문 머리(제목·메타)를
 * 고른 회의의 목록 요약으로 바로 바꾸고, 들고 있는 이전 본문만 흐리게 · `aria-busy` · `inert` 로 묶는다 (UX1-M02).
 * 시간이 지나면 새 회의로 넘어가 본문 모양 스켈레톤을 그린다 — 이전 회의 내용이 새 회의 것처럼 남지 않는다.
 */
export function useShownMeeting(
  workspaceId: string,
  meetingId: string | null,
  canHold: boolean,
): ShownMeeting {
  const settled = useMinutesSettled(workspaceId, meetingId)
  return useSelectionTimeline(meetingId, settled, canHold)
}
