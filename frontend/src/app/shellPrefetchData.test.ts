import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { onTestFinished } from 'vitest'
import {
  latestMinutesId,
  meetingListQueryOptions,
  meetingDetailQueryOptions,
} from '@/entities/meeting'
import { messageInboxQueryOptions, messageThreadQueryOptions } from '@/entities/message'
import { minutesQueryOptions } from '@/entities/minutes'
import { prefetchMeetings } from '@/pages/meetings/prefetch'
import { createQueryClient } from '@/shared/api/queryClient'
import { endSessionScope } from '@/shared/api/sessionScope'
import { applyScenario } from '@/shared/mock/scenarios'
import { recordRequests } from '@/shared/test/requests'
import { latestDoneMeeting } from '@/widgets/dashboard/lib/dashboard'
import { prefetchDashboard } from '@/widgets/dashboard/prefetch'
import { prefetchMessageInbox } from '@/widgets/message-inbox/prefetch'

/*
 * #536 리뷰 — 목록 → 상세로 잇는 미리 받기의 두 경계.
 * ① 목록을 받은 뒤 세션이 끝나면(로그아웃·만료) 이어지는 상세 조회를 새로 시작하지 않는다. 세션을 끝내는 코드는 진행 중인 조회만
 *    거두므로, 목록 답과 세션 끝이 겹치면 미리 받기가 스스로 멈춰야 한다.
 * ② 목록 캐시가 오래됐으면 새 목록을 기다려 그 목록으로 상세를 고른다 — 화면이 고를 상세를 받는다.
 * 화면 없이 미리 받기 함수와 QueryClient, MSW 만 쓴다.
 */

const WS = 'ws_01'

function client(): QueryClient {
  const queryClient = createQueryClient()
  onTestFinished(() => queryClient.clear())
  return queryClient
}

const LONG_AGO = () => Date.now() - 10 * 60_000

const status = (queryClient: QueryClient, queryKey: QueryKey) =>
  queryClient.getQueryState(queryKey)?.status

const isDetailFollowUp = ({ path }: { path: string }) =>
  /^\/meetings\/[^/?]+/.test(path) || path.startsWith('/extractions/') || path.includes('/threads/')

describe('목록을 받은 뒤 세션이 끝나면 이어지는 상세를 받지 않는다', () => {
  it('회의록: 기본 회의의 상세·회의록을 시작하지 않는다', async () => {
    const queryClient = client()
    await queryClient.fetchQuery(meetingListQueryOptions(WS))
    const requests = recordRequests()

    const done = prefetchMeetings(queryClient, { workspaceId: WS, isPm: true })
    endSessionScope()
    await done

    expect(requests.started.filter(isDetailFollowUp)).toEqual([])
  })

  it('대시보드: 최신 완료 회의의 상세·추출을 시작하지 않는다', async () => {
    const queryClient = client()
    await queryClient.fetchQuery(meetingListQueryOptions(WS))
    const requests = recordRequests()

    const done = prefetchDashboard(queryClient, { workspaceId: WS, isPm: true })
    endSessionScope()
    await done

    expect(requests.started.filter(isDetailFollowUp)).toEqual([])
  })

  it('메시지(팀원): 처음 열 대화를 시작하지 않는다', async () => {
    applyScenario('messages-member')
    const queryClient = client()
    await queryClient.fetchQuery(messageInboxQueryOptions(WS))
    const requests = recordRequests()

    const done = prefetchMessageInbox(queryClient, { workspaceId: WS, compact: false })
    endSessionScope()
    await done

    expect(requests.started.filter(isDetailFollowUp)).toEqual([])
  })
})

describe('목록 캐시가 오래됐으면 새 목록으로 상세를 고른다', () => {
  it('회의록: 새 목록의 가장 최근 회의록을 받고, 오래된 목록의 회의는 받지 않는다', async () => {
    const queryClient = client()
    const fresh = await queryClient.fetchQuery(meetingListQueryOptions(WS))
    const latest = latestMinutesId(fresh)
    if (latest === null) throw new Error('no minutes in the mock list')
    // 오래된 목록에는 가장 최근 회의가 아직 없다
    const stale = fresh.filter(({ id }) => id !== latest)
    const older = latestMinutesId(stale)
    queryClient.setQueryData(meetingListQueryOptions(WS).queryKey, stale, {
      updatedAt: LONG_AGO(),
    })
    const requests = recordRequests()

    await prefetchMeetings(queryClient, { workspaceId: WS, isPm: true })

    expect(status(queryClient, minutesQueryOptions(WS, latest).queryKey)).toBe('success')
    expect(requests.started.map(({ path }) => path)).not.toContain(`/meetings/${older}`)
  })

  it('대시보드: 새 목록의 최신 완료 회의 상세를 받는다', async () => {
    const queryClient = client()
    const fresh = await queryClient.fetchQuery(meetingListQueryOptions(WS))
    const latest = latestDoneMeeting(fresh)
    if (latest === null) throw new Error('no done meeting in the mock list')
    const stale = fresh.filter(({ id }) => id !== latest.id)
    queryClient.setQueryData(meetingListQueryOptions(WS).queryKey, stale, {
      updatedAt: LONG_AGO(),
    })

    await prefetchDashboard(queryClient, { workspaceId: WS, isPm: true })

    expect(status(queryClient, meetingDetailQueryOptions(WS, latest.id).queryKey)).toBe('success')
  })

  it('메시지(팀원): 새 목록의 첫 대화를 받는다', async () => {
    applyScenario('messages-member')
    const queryClient = client()
    const fresh = await queryClient.fetchQuery(messageInboxQueryOptions(WS))
    const first = fresh.threads[0]
    if (first === undefined) throw new Error('member inbox has no thread')
    // 오래된 목록의 첫 대화는 지금은 없는 대화다
    queryClient.setQueryData(
      messageInboxQueryOptions(WS).queryKey,
      { ...fresh, threads: [{ ...first, id: 'th_gone' }, ...fresh.threads.slice(1)] },
      { updatedAt: LONG_AGO() },
    )
    const requests = recordRequests()

    await prefetchMessageInbox(queryClient, { workspaceId: WS, compact: false })

    expect(status(queryClient, messageThreadQueryOptions(WS, first.id).queryKey)).toBe('success')
    expect(requests.started.some(({ path }) => path.includes('th_gone'))).toBe(false)
  })
})
