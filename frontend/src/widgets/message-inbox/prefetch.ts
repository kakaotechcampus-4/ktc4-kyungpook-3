import type { QueryClient } from '@tanstack/react-query'
import { messageInboxQueryOptions, messageThreadQueryOptions } from '@/entities/message'
import { selectDetail } from './model/selection'

/**
 * 메시지 화면의 첫 화면 조회를 미리 받는다 (#536). 셸 탭이 여는 주소(`/messages`, 고른 것 없음) 기준이다.
 * 이 파일은 화면 코드와 따로 부를 수 있는 입구다 — 셸이 정적으로 가져와도 메시지 화면이 첫 번들에 끼지 않는다.
 *
 * 목록을 받고, 넓은 화면이 목록에서 처음 열 상세까지 받는다 — 화면과 같은 고르기(`selectDetail`)다.
 * 팀원은 첫 대화를 열어 그 대화를 받는다. PM 은 보낼 메시지(묶음)를 여는데 묶음은 목록에 이미 있어 더 받을 것이 없다.
 * 휴대폰(`compact`)은 아무것도 고르지 않고 목록만 보이므로 상세를 받지 않는다.
 * 화면과 같은 query options 를 쓰고, 이미 받은 값은 다시 받지 않는다. 실패는 삼킨다 — 화면이 뜨면 같은 Query 가 다시 묻는다.
 */
export async function prefetchMessageInbox(
  queryClient: QueryClient,
  { workspaceId, compact }: { workspaceId: string; compact: boolean },
): Promise<void> {
  try {
    const inbox = await queryClient.ensureQueryData({
      ...messageInboxQueryOptions(workspaceId),
      revalidateIfStale: true,
    })
    if (compact) return
    const first = selectDetail({
      inbox,
      threadId: null,
      bundleId: undefined,
      invalidPath: false,
      composing: false,
    })
    if (first.kind === 'thread')
      await queryClient.prefetchQuery(messageThreadQueryOptions(workspaceId, first.threadId))
  } catch {
    // 미리 받기의 실패는 알리지 않는다 — 화면의 조회가 다시 묻는다
  }
}
