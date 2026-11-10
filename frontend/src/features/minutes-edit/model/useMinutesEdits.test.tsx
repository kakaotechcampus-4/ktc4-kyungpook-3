import { QueryClientProvider, onlineManager, useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { minutesQueryOptions } from '@/entities/minutes'
import { createQueryClient } from '@/shared/api/queryClient'
import { workspaceKey } from '@/shared/api/queryKeys'
import { endSessionScope } from '@/shared/api/sessionScope'
import { db } from '@/shared/mock/db'
import { ok } from '@/shared/mock/envelope'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { useToastStore } from '@/shared/ui/toast'
import { useLineEdit, useTitleEdit } from './useMinutesEdits'

/** 회의록 화면처럼 mt_09 회의록을 지켜보며 제목과 발화를 고친다 */
function renderEdits(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(
    () => ({
      minutes: useQuery(minutesQueryOptions('ws_01', 'mt_09')),
      title: useTitleEdit('ws_01', 'mt_09'),
      line: useLineEdit('ws_01', 'mt_09'),
    }),
    { wrapper },
  )
}

const patches = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ method }) => method === 'PATCH')
const minutesReads = (log: ReturnType<typeof recordRequests>) =>
  log.started.filter(({ method, path }) => method === 'GET' && path === '/meetings/mt_09/minutes')
const storedLine = (seq: number) =>
  db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09')!.transcript[seq]

afterEach(() => {
  onlineManager.setOnline(true)
  useToastStore.getState().clear()
})

async function ready(client: QueryClient) {
  const view = renderEdits(client)
  await waitFor(() => expect(view.result.current.minutes.data).toBeDefined())
  return view
}

describe('useLineEdit', () => {
  it('고친 줄만 응답으로 바꾸고 회의록을 다시 받지 않는다 (§4.4.3)', async () => {
    const client = createQueryClient()
    const { result } = await ready(client)
    const before = result.current.minutes.data!.transcript
    const log = recordRequests()
    const onSaved = vi.fn()

    act(() =>
      result.current.line.save({ seq: 1, text: '회원가입 화면은 민수가 맡겠습니다.' }, onSaved),
    )

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    const after = result.current.minutes.data!.transcript
    expect(after[1]).toMatchObject({
      seq: 1,
      text: '회원가입 화면은 민수가 맡겠습니다.',
      edited: true,
      originalText: '회원가입 화면은 제가 맡겠습니다.',
    })
    expect(after.filter((_, index) => index !== 1)).toEqual(
      before.filter((_, index) => index !== 1),
    )
    expect(patches(log)).toEqual([{ method: 'PATCH', path: '/meetings/mt_09/transcript/1' }])
    expect(minutesReads(log)).toEqual([])
    expect(client.getQueryState(workspaceKey('ws_01', 'minutes', 'mt_09'))?.isInvalidated).toBe(
      false,
    )
  })

  it('null 로 원문으로 되돌리고 알린다', async () => {
    const client = createQueryClient()
    const { result } = await ready(client)
    act(() => result.current.line.save({ seq: 0, text: '고친 문장' }))
    await waitFor(() => expect(result.current.minutes.data!.transcript[0].edited).toBe(true))

    act(() => result.current.line.save({ seq: 0, text: null }))

    await waitFor(() =>
      expect(result.current.minutes.data!.transcript[0]).toMatchObject({
        text: '이번 주 진행 상황부터 공유해요.',
        edited: false,
        originalText: null,
      }),
    )
    expect(useToastStore.getState().items.map(({ title }) => title)).toEqual([
      '원래 문장으로 되돌렸어요',
    ])
  })

  it('누른 뒤 보내기 전에 세션이 끝나면 다시 연결돼도 보내지 않는다', async () => {
    const client = createQueryClient()
    const { result } = await ready(client)
    const log = recordRequests()

    onlineManager.setOnline(false)
    act(() => result.current.line.save({ seq: 1, text: '다른 세션의 글' }))
    await waitFor(() =>
      expect(
        client
          .getMutationCache()
          .getAll()
          .filter(({ state }) => state.isPaused),
      ).toHaveLength(1),
    )
    act(() => endSessionScope())
    onlineManager.setOnline(true)

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(patches(log)).toEqual([])
    expect(result.current.line.failure).toBeNull()
    expect(storedLine(1).edited).toBe(false)
  })

  it('응답을 기다리는 사이 세션이 끝나면 요청을 끊고 캐시·문구·알림에 남기지 않는다', async () => {
    const client = createQueryClient()
    const { result } = await ready(client)
    const gate = deferred()
    server.use(
      http.patch('/api/v1/meetings/:meetingId/transcript/:seq', async () => {
        await gate.promise
        return ok({ seq: 1, text: '늦은 응답', original_text: '원문', edited: true })
      }),
    )

    act(() => result.current.line.save({ seq: 1, text: '늦은 응답' }))
    await waitFor(() => expect(client.isMutating()).toBe(1))
    act(() => endSessionScope())
    gate.resolve()

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(result.current.minutes.data!.transcript[1].text).toBe('회원가입 화면은 제가 맡겠습니다.')
    expect(result.current.line.failure).toBeNull()
    expect(useToastStore.getState().items).toEqual([])
  })

  it('같은 틱에 두 번 눌러도 한 번만 보낸다', async () => {
    const client = createQueryClient()
    const { result } = await ready(client)
    const log = recordRequests()

    act(() => {
      result.current.line.save({ seq: 1, text: '하나' })
      result.current.line.save({ seq: 2, text: '둘' })
    })

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(patches(log)).toEqual([{ method: 'PATCH', path: '/meetings/mt_09/transcript/1' }])
  })

  it('응답을 읽지 못하면 실패라 하지 않고 「변경 결과를 확인하지 못했어요」와 함께 회의록을 다시 받는다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => {
      vi.restoreAllMocks()
    })
    const client = createQueryClient()
    const { result } = await ready(client)
    server.use(
      http.patch('/api/v1/meetings/:meetingId/transcript/:seq', () => ok({ seq: '1', text: 3 })),
    )
    const log = recordRequests()

    act(() => result.current.line.save({ seq: 1, text: '고친 문장' }))

    await waitFor(() =>
      expect(useToastStore.getState().items.map(({ title }) => title)).toEqual([
        '변경 결과를 확인하지 못했어요',
      ]),
    )
    expect(result.current.line.failure).toBeNull()
    await waitFor(() => expect(minutesReads(log)).toHaveLength(1))
  })
})

describe('useTitleEdit', () => {
  it('회의록 제목을 응답으로 바꾸고 회의·회의록·프로젝트 맵을 다시 받게 한다 (§4.4.3)', async () => {
    const client = createQueryClient()
    const { result } = await ready(client)
    const other = workspaceKey('ws_01', 'minutes', 'mt_07')
    const map = workspaceKey('ws_01', 'project-map')
    const list = workspaceKey('ws_01', 'meetings', 'list')
    const tasks = workspaceKey('ws_01', 'tasks')
    for (const key of [other, map, list, tasks]) client.setQueryData(key, { cached: true })

    act(() => result.current.title.save({ title: '  3주차 정기 회의 ' }))

    await waitFor(() =>
      expect(result.current.minutes.data).toMatchObject({
        title: '3주차 정기 회의',
        titleEdited: true,
        titleOriginal: '3주차 정기회의',
      }),
    )
    for (const key of [other, map, list])
      expect(client.getQueryState(key)?.isInvalidated, String(key)).toBe(true)
    expect(client.getQueryState(tasks)?.isInvalidated).toBe(false)
    expect(db.meetings.find(({ meeting_id }) => meeting_id === 'mt_09')?.title).toBe(
      '3주차 정기 회의',
    )
  })
})
