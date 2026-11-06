import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { getResponse, http } from 'msw'
import type { ReactNode } from 'react'
import { taskDetailQueryOptions } from '@/entities/task'
import { advanceSessionGeneration } from '@/entities/user'
import { createQueryClient } from '@/shared/api/queryClient'
import { handlers } from '@/shared/mock/handlers'
import { server } from '@/shared/mock/server'
import { deferred } from '@/shared/test/deferred'
import { recordRequestBodies, recordRequests } from '@/shared/test/requests'
import type { TaskFieldChange } from './draft'
import { useTaskFieldsSave } from './useTaskFieldsSave'

/* 모의 태스크 tk_01 은 담당자 mb_01, 마감 2026-09-20 이다 */
const TASK_PATH = '/tasks/tk_01'
const detailKey = taskDetailQueryOptions('ws_01', 'tk_01').queryKey

const DUE_TO_26: TaskFieldChange = { field: 'dueDate', from: '2026-09-20', to: '2026-09-26' }

/** 상세 화면처럼 그 태스크를 지켜보며 저장한다 */
function renderSave(client: QueryClient) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return renderHook(
    () => ({
      detail: useQuery(taskDetailQueryOptions('ws_01', 'tk_01')),
      saving: useTaskFieldsSave('ws_01', 'tk_01'),
    }),
    { wrapper },
  )
}

async function renderLoaded() {
  const client = createQueryClient()
  const rendered = renderSave(client)
  await waitFor(() => expect(rendered.result.current.detail.data).toBeDefined())
  return { client, ...rendered }
}

describe('useTaskFieldsSave', () => {
  it('바뀐 마감만 보내고, 돌려받은 태스크로 상세를 바꾼다', async () => {
    const { result, client } = await renderLoaded()
    const bodies = recordRequestBodies('PATCH', TASK_PATH)
    const onSaved = vi.fn()

    act(() => result.current.saving.save([DUE_TO_26], onSaved))

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(bodies).toEqual([{ due_date: '2026-09-26' }])
    expect(client.getQueryData(detailKey)).toMatchObject({
      dueDate: '2026-09-26',
      assigneeMemberId: 'mb_01',
    })
    expect(result.current.saving.errorMessage).toBeNull()
  })

  it('담당자를 비우면 담당자만 null 로 보낸다', async () => {
    const { result, client } = await renderLoaded()
    const bodies = recordRequestBodies('PATCH', TASK_PATH)

    act(() => result.current.saving.save([{ field: 'assignee', from: 'mb_01', to: null }]))

    await waitFor(() => expect(client.getQueryData(detailKey)?.assigneeMemberId).toBeNull())
    expect(bodies).toEqual([{ assignee_member_id: null }])
    expect(client.getQueryData(detailKey)?.dueDate).toBe('2026-09-20')
  })

  it('바뀐 것이 없으면 보내지 않는다', async () => {
    const { result, client } = await renderLoaded()
    const log = recordRequests()

    act(() => result.current.saving.save([]))

    expect(client.isMutating()).toBe(0)
    expect(log.started.filter(({ method }) => method === 'PATCH')).toEqual([])
    expect(result.current.saving.pending).toBe(false)
  })

  it('서버가 거절하면 문구를 남기고 캐시는 그대로다. 다음 저장이 문구를 지운다', async () => {
    const { result, client } = await renderLoaded()
    const before = client.getQueryData(detailKey)

    act(() => result.current.saving.save([{ field: 'assignee', from: 'mb_01', to: 'mb_99' }]))

    await waitFor(() => expect(result.current.saving.errorMessage).toBe('팀원을 찾을 수 없어요.'))
    expect(client.getQueryData(detailKey)).toBe(before)

    act(() => result.current.saving.save([DUE_TO_26]))
    expect(result.current.saving.errorMessage).toBeNull()
    await waitFor(() => expect(client.getQueryData(detailKey)?.dueDate).toBe('2026-09-26'))
  })

  it('요청 중 세션이 끝나면 늦은 응답을 캐시·결과에 남기지 않는다', async () => {
    const gate = deferred()
    server.use(
      http.patch(
        `/api/v1${TASK_PATH}`,
        async ({ request }) => {
          await gate.promise
          return getResponse(handlers, request.clone())
        },
        { once: true },
      ),
    )
    const { result, client } = await renderLoaded()
    const before = client.getQueryData(detailKey)
    const log = recordRequests()
    const onSaved = vi.fn()

    act(() => result.current.saving.save([DUE_TO_26], onSaved))
    await waitFor(() => expect(log.timeline).toContain(`start PATCH ${TASK_PATH}`))
    act(() => advanceSessionGeneration())
    gate.resolve()

    await waitFor(() => expect(client.isMutating()).toBe(0))
    expect(client.getQueryData(detailKey)).toBe(before)
    expect(onSaved).not.toHaveBeenCalled()
    expect(result.current.saving.errorMessage).toBeNull()
  })
})
