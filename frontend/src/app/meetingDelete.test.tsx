import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { paths } from '@/shared/config/routes'
import { minutesQueryOptions } from '@/entities/minutes'
import { meetingDetailQueryOptions } from '@/entities/meeting'
import { workspaceKey } from '@/shared/api/queryKeys'
import { db } from '@/shared/mock/db'
import { fail, list, ok } from '@/shared/mock/envelope'
import { purgeMeeting } from '@/shared/mock/meetingDeletion'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { recordRequests } from '@/shared/test/requests'
import { deferred } from '@/shared/test/deferred'
import { renderApp } from './test/renderApp'

vi.setConfig({ testTimeout: 10_000 })

async function open() {
  const app = renderApp(paths.meetings('ws_01', 'mt_09'))
  await screen.findByRole('heading', { level: 2, name: '3주차 정기회의' })
  return app
}

it('취소는 쓰기 요청을 보내지 않는다', async () => {
  const log = recordRequests()
  await open()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '회의 삭제' }))
  const modal = screen.getByRole('dialog')
  expect(modal).toHaveTextContent('태스크는 남아요')
  await user.click(within(modal).getByRole('button', { name: '취소' }))
  expect(log.started.filter(({ method }) => method === 'DELETE')).toHaveLength(0)
  expect(screen.getByRole('heading', { level: 2, name: '3주차 정기회의' })).toBeInTheDocument()
})

it('회의를 지워도 태스크와 이력을 보존하며 삭제된 원본 링크를 없앤다', async () => {
  const before = structuredClone(db.tasks.find(({ task_id }) => task_id === 'tk_01'))
  const history = structuredClone(db.taskHistory)
  const app = await open()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '회의 삭제' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제하기' }))
  await waitFor(() =>
    expect(db.meetings.some(({ meeting_id }) => meeting_id === 'mt_09')).toBe(false),
  )
  expect(db.tasks.find(({ task_id }) => task_id === 'tk_01')).toEqual(before)
  expect(db.taskHistory).toEqual(history)
  await act(async () => {
    app.navigate(paths.tasks('ws_01', 'tk_01'))
    await Promise.resolve()
  })
  expect(await screen.findByText('원본 회의가 삭제되어 근거를 볼 수 없음')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /에서 나온 일/ })).not.toBeInTheDocument()
  await act(async () => {
    app.navigate(paths.meetings('ws_01', 'mt_09'))
    await Promise.resolve()
  })
  expect(await screen.findByRole('heading', { name: '삭제된 회의예요' })).toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { level: 2, name: '3주차 정기회의' }),
  ).not.toBeInTheDocument()
})

it('팀원에게는 삭제 버튼을 표시하지 않는다', async () => {
  setMockRole('member', 'ws_01')
  await open()
  expect(screen.queryByRole('button', { name: '회의 삭제' })).not.toBeInTheDocument()
})

it('회의 목록에 없다는 이유로 태스크의 출처를 삭제되었다고 추정하지 않는다', async () => {
  server.use(http.get('/api/v1/workspaces/:workspaceId/meetings', () => list([])))
  renderApp(paths.tasks('ws_01', 'tk_01'))
  expect(await screen.findByRole('link', { name: '연결된 회의에서 나온 일' })).toBeInTheDocument()
  expect(screen.queryByText('원본 회의가 삭제되어 근거를 볼 수 없음')).not.toBeInTheDocument()
})

it('서버가 삭제한 재시도 계열의 모든 상세 캐시와 목록을 제거한다', async () => {
  const app = await open()
  await app.queryClient.fetchQuery(meetingDetailQueryOptions('ws_01', 'mt_08'))
  server.use(
    http.delete('/api/v1/meetings/:meetingId', () => {
      const receipt = {
        meeting_id: 'mt_09',
        deleted_at: '2026-11-08T15:00:00Z',
        cleanup_status: 'pending' as const,
        deleted_meeting_ids: ['mt_09', 'mt_08'],
      }
      for (const id of receipt.deleted_meeting_ids) {
        db.meetingDeletions.push({ ...receipt, meeting_id: id, workspace_id: 'ws_01' })
        purgeMeeting(id)
      }
      return ok(receipt, { status: 202 })
    }),
  )
  await userEvent.click(screen.getByRole('button', { name: '회의 삭제' }))
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: '삭제하기' }),
  )
  await screen.findByRole('heading', { name: '2주차 정기회의', level: 2 })
  for (const id of ['mt_09', 'mt_08'])
    expect(
      app.queryClient.getQueryData(meetingDetailQueryOptions('ws_01', id).queryKey),
    ).toBeUndefined()
  expect(
    within(screen.getByRole('complementary', { name: '회의 목록' })).queryByRole('link', {
      name: /3주차 정기회의|채팅 2026-09-11/,
    }),
  ).not.toBeInTheDocument()
})

it.each([
  ['MEETING_DELETE_BLOCKED', 409, '정리 중인 회의는 삭제할 수 없어요'],
  ['INTERNAL_ERROR', 500, '회의를 삭제하지 못했어요'],
])('삭제 실패 %s 에서 원본을 보존하고 자동 재시도하지 않는다', async (code, status, message) => {
  let calls = 0
  server.use(
    http.delete('/api/v1/meetings/:meetingId', () => {
      calls += 1
      return fail(code, '삭제 실패', status)
    }),
  )
  await open()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '회의 삭제' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제하기' }))
  expect(await screen.findByText(message)).toBeInTheDocument()
  expect(calls).toBe(1)
  expect(db.meetings.some(({ meeting_id }) => meeting_id === 'mt_09')).toBe(true)
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '취소' }))
  expect(screen.getByRole('heading', { level: 2, name: '3주차 정기회의' })).toBeInTheDocument()
})

it('빠르게 두 번 눌러도 한 요청만 보내며 진행 중에는 닫지 못한다', async () => {
  const gate = deferred()
  let calls = 0
  server.use(
    http.delete('/api/v1/meetings/:meetingId', async () => {
      calls += 1
      await gate.promise
    }),
  )
  await open()
  await userEvent.click(screen.getByRole('button', { name: '회의 삭제' }))
  const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: '삭제하기' })
  act(() => {
    fireEvent.click(confirm)
    fireEvent.click(confirm)
  })
  await waitFor(() => expect(calls).toBe(1))
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: '취소' })).toBeDisabled()
  await act(async () => {
    gate.resolve()
    await gate.promise
  })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('삭제 전에 출발한 회의록 조회를 취소하고 늦은 원문이 캐시에 살아나지 않는다', async () => {
  const app = await open()
  const stale = structuredClone(db.minutes.find(({ meeting_id }) => meeting_id === 'mt_09'))
  if (!stale) throw new Error('minutes fixture is missing')
  const gate = deferred()
  let started = false
  let readSignal: AbortSignal | undefined
  server.use(
    http.get('/api/v1/meetings/:meetingId/minutes', async () => {
      started = true
      await gate.promise
      return ok(stale)
    }),
  )
  const options = minutesQueryOptions('ws_01', 'mt_09')
  const queryFn = options.queryFn
  if (typeof queryFn !== 'function') throw new Error('minutes query must have a queryFn')
  const oldRead = app.queryClient
    .fetchQuery({
      ...options,
      staleTime: 0,
      queryFn: (context) => {
        readSignal = context.signal
        return queryFn(context)
      },
    })
    .catch(() => undefined)
  await waitFor(() => expect(started).toBe(true))
  await userEvent.click(screen.getByRole('button', { name: '회의 삭제' }))
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: '삭제하기' }),
  )
  await waitFor(() => expect(readSignal?.aborted).toBe(true))
  await act(async () => {
    gate.resolve()
    await oldRead
  })
  expect(
    app.queryClient.getQueryData(minutesQueryOptions('ws_01', 'mt_09').queryKey),
  ).toBeUndefined()
  expect(
    app.queryClient.getQueryData(meetingDetailQueryOptions('ws_01', 'mt_09').queryKey),
  ).toBeUndefined()
  expect(
    app.queryClient.getQueryData(workspaceKey('ws_01', 'extractions', 'ex_01')),
  ).toBeUndefined()
})

it('다른 화면으로 이동한 뒤 늦은 삭제 응답은 현재 화면과 토스트를 바꾸지 않는다', async () => {
  const gate = deferred()
  let started = false
  server.use(
    http.delete('/api/v1/meetings/:meetingId', async () => {
      started = true
      await gate.promise
      const receipt = {
        meeting_id: 'mt_09',
        deleted_meeting_ids: ['mt_09'],
        deleted_at: '2026-11-08T15:00:00Z',
        cleanup_status: 'pending' as const,
      }
      db.meetingDeletions.push({ ...receipt, workspace_id: 'ws_01' })
      purgeMeeting('mt_09')
      return ok(receipt, { status: 202 })
    }),
  )
  const app = await open()
  await userEvent.click(screen.getByRole('button', { name: '회의 삭제' }))
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: '삭제하기' }),
  )
  await waitFor(() => expect(started).toBe(true))
  await act(async () => {
    app.navigate(paths.tasks('ws_01', 'tk_01'))
    await Promise.resolve()
  })
  await act(async () => {
    gate.resolve()
    await gate.promise
  })
  await app.expectPath(paths.tasks('ws_01', 'tk_01'))
  await waitFor(() =>
    expect(app.queryClient.getQueryData(minutesQueryOptions('ws_01', 'mt_09').queryKey))
      .toBeUndefined(),
  )
  expect(app.queryClient.getQueryData(meetingDetailQueryOptions('ws_01', 'mt_09').queryKey))
    .toBeUndefined()
  expect(
    screen.queryByText('회의를 삭제했어요. 남은 파일을 정리하고 있어요.'),
  ).not.toBeInTheDocument()
  await act(async () => {
    app.navigate(paths.meetings('ws_01', 'mt_09'))
    await Promise.resolve()
  })
  expect(await screen.findByRole('heading', { name: '삭제된 회의예요' })).toBeInTheDocument()
  expect(screen.queryByTestId('minutes-body')).not.toBeInTheDocument()
})

it('이미 받은 회의록도 서버가 410을 반환하면 숨긴다', async () => {
  const app = await open()
  server.use(
    http.get('/api/v1/meetings/:meetingId/minutes', () =>
      fail('MEETING_DELETED', '삭제된 회의', 410),
    ),
  )
  await act(async () =>
    app.queryClient.invalidateQueries({ queryKey: minutesQueryOptions('ws_01', 'mt_09').queryKey }),
  )
  expect(await screen.findByRole('heading', { name: '삭제된 회의예요' })).toBeInTheDocument()
  expect(screen.queryByTestId('minutes-body')).not.toBeInTheDocument()
})
