import type { QueryClient } from '@tanstack/react-query'
import { latestMinutesId, meetingListQueryOptions } from '@/entities/meeting'
import { prefetchMinutes } from '@/widgets/meeting-minutes/prefetch'

/**
 * 회의록 탭의 첫 화면 조회를 미리 받는다 (#536). 셸 탭이 여는 주소(`/meetings`, 고른 회의 없음) 기준이다.
 * 이 파일은 화면 코드와 따로 부를 수 있는 입구다 — 셸이 정적으로 가져와도 회의록 화면이 첫 번들에 끼지 않는다.
 *
 * 목록을 받고, 기본 선택(useDefaultMinutesSelection — 가장 최근 회의록)이 열 회의록까지 받는다. 그 회의록은 목록 행을
 * 가리킬 때와 같은 미리 받기(`prefetchMinutes`)로 받는다 — 역할에 따른 차이(승인 목록은 PM 이고 권한이 있을 때만)도 그대로다.
 * 이미 받은 값은 다시 받지 않는다. 실패는 삼킨다 — 화면이 뜨면 같은 Query 가 다시 묻는다.
 */
export async function prefetchMeetings(
  queryClient: QueryClient,
  { workspaceId, isPm }: { workspaceId: string; isPm: boolean },
): Promise<void> {
  try {
    const meetings = await queryClient.ensureQueryData({
      ...meetingListQueryOptions(workspaceId),
      revalidateIfStale: true,
    })
    const latestId = latestMinutesId(meetings)
    if (latestId !== null)
      await prefetchMinutes(queryClient, { workspaceId, meetingId: latestId, isPm })
  } catch {
    // 미리 받기의 실패는 알리지 않는다 — 화면의 조회가 다시 묻는다
  }
}
