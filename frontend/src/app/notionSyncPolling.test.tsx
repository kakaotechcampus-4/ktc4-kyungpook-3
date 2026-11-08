import { onTestFinished } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { clearTrackedMeetings } from '@/entities/meeting'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { fail, ok } from '@/shared/mock/envelope'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { toTaskResponse } from '@/shared/mock/task-state'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

/*
 * M6 S4 — Notion 반영 상태 polling·재시도 (계획 §4-7, §4-8, AC-07).
 * 간격만 가짜 시계로 움직인다 — `setInterval`·`clearInterval`·`Date` 만 가짜이고 setTimeout·MSW 응답은 진짜다.
 * TanStack Query 의 refetchInterval 은 전역 setInterval 을 부른다(query-core timeoutManager). 가짜 시계는 테스트가 밀 때만 간다.
 * DOM 이 아닌 값(요청 수)은 RTL waitFor 의 간격 검사(setInterval)가 돌지 않으므로 진짜 setTimeout 으로 기다린다.
 */

vi.setConfig({ testTimeout: 20_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
  clearTrackedMeetings()
})

type Log = ReturnType<typeof recordRequests>

const pause = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)))
/** 가짜 시계를 민다. 그 사이 만기된 간격이 돈다 */
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))
/** 진짜 시간으로 조건이 맞을 때까지 기다린다 (최대 2초) */
async function until(check: () => void): Promise<void> {
  for (let waited = 0; ; waited += 20) {
    try {
      check()
      return
    } catch (error) {
      if (waited >= 2_000) throw error
      await pause(20)
    }
  }
}

function taskOf(id: string) {
  const found = db.tasks.find(({ task_id }) => task_id === id)
  if (!found) throw new Error(`fixture ${id} is missing`)
  return found
}
const taskGets = (log: Log, id: string) =>
  log.started.filter(({ method, path }) => method === 'GET' && path === `/tasks/${id}`).length
const retries = (log: Log, id: string) =>
  log.started.filter(
    ({ method, path }) => method === 'POST' && path === `/tasks/${id}/notion-sync/retry`,
  ).length
const label = () => screen.getByTestId('notion-sync-status').textContent

async function openTask(id: string, title: string) {
  const log = recordRequests()
  const app = renderApp(paths.tasks('ws_01', id))
  await screen.findByRole('heading', { level: 1, name: title })
  await waitFor(() => expect(screen.getByTestId('notion-sync-status')).toBeInTheDocument())
  // 첫 조회(상세·이력·팀원)가 끝나 조용해질 때까지
  await pause(150)
  return { app, log }
}

describe('반영 중 polling (AC-07)', () => {
  it('pending 인 동안 3초마다 그 태스크를 조회하고, synced 가 오면 반영됨으로 바꾸고 멈춘다', async () => {
    taskOf('tk_04').notion_sync_status = 'pending'
    const { log } = await openTask('tk_04', '배포 스크립트')
    expect(label()).toBe('반영 중')
    const first = taskGets(log, 'tk_04')

    await advance(2_999)
    await pause(100)
    expect(taskGets(log, 'tk_04')).toBe(first)

    await advance(1)
    await until(() => expect(taskGets(log, 'tk_04')).toBe(first + 1))
    await pause(100)
    expect(label()).toBe('반영 중')

    // 다음 간격도 3초 — 그 사이 워커가 반영을 끝냈다
    taskOf('tk_04').notion_sync_status = 'synced'
    await advance(2_999)
    await pause(100)
    expect(taskGets(log, 'tk_04')).toBe(first + 1)
    await advance(1)
    await until(() => expect(label()).toBe('반영됨'))
    expect(taskGets(log, 'tk_04')).toBe(first + 2)

    // 종료 상태에서는 더 묻지 않는다
    await advance(15_000)
    await pause(150)
    expect(taskGets(log, 'tk_04')).toBe(first + 2)
  })

  it('pending → failed 면 멈추고, PM 의 재시도 성공 응답(반영 중)을 보인 뒤 실제 synced 까지 기다린다', async () => {
    taskOf('tk_04').notion_sync_status = 'pending'
    const { log } = await openTask('tk_04', '배포 스크립트')
    const first = taskGets(log, 'tk_04')

    taskOf('tk_04').notion_sync_status = 'failed'
    await advance(3_000)
    await until(() => expect(label()).toBe('반영 실패'))
    expect(taskGets(log, 'tk_04')).toBe(first + 1)
    await advance(15_000)
    await pause(150)
    expect(taskGets(log, 'tk_04')).toBe(first + 1)

    // 재시도 — 같은 틱의 두 번째 누름은 보내지 않는다
    const retry = screen.getByRole('button', { name: '다시 반영하기' })
    act(() => {
      fireEvent.click(retry)
      fireEvent.click(retry)
    })
    await until(() => expect(label()).toBe('반영 중'))
    expect(retries(log, 'tk_04')).toBe(1)
    expect(screen.getByText('다시 반영을 요청했어요. 반영되면 여기에서 바뀌어요.')).toBeVisible()
    expect(screen.queryByRole('button', { name: '다시 반영하기' })).toBeNull()
    expect(taskOf('tk_04').notion_sync_status).toBe('pending')

    // 재시도 응답으로 polling 이 다시 돈다. 아직 반영 중이면 반영 중 그대로다
    const afterRetry = taskGets(log, 'tk_04')
    await advance(3_000)
    await until(() => expect(taskGets(log, 'tk_04')).toBe(afterRetry + 1))
    await pause(100)
    expect(label()).toBe('반영 중')

    taskOf('tk_04').notion_sync_status = 'synced'
    await advance(3_000)
    await until(() => expect(label()).toBe('반영됨'))
    expect(screen.queryByText('다시 반영을 요청했어요. 반영되면 여기에서 바뀌어요.')).toBeNull()
    await advance(15_000)
    await pause(150)
    expect(taskGets(log, 'tk_04')).toBe(afterRetry + 2)
    expect(retries(log, 'tk_04')).toBe(1)
  })

  it('재시도 응답을 읽지 못하면 버튼 가까이에 실패라 하지 않고 결과를 확인하지 못했다고 알린다. 새로고침은 태스크를 다시 받는다 (#348)', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    onTestFinished(() => warning.mockRestore())
    taskOf('tk_04').notion_sync_status = 'failed'
    server.use(
      http.post('/api/v1/tasks/:taskId/notion-sync/retry', () =>
        ok({
          ...toTaskResponse(db.tasks.find(({ task_id }) => task_id === 'tk_04')!),
          status: 'archived',
        }),
      ),
    )
    const { log } = await openTask('tk_04', '배포 스크립트')
    const retry = screen.getByRole('button', { name: '다시 반영하기' })
    await userEvent.click(retry)
    const notice = (
      await screen.findByText('변경 결과를 확인하지 못했어요', {}, { timeout: 5_000 })
    ).closest('li') as HTMLElement
    expect(within(notice).getByText(/서버에는 반영됐을 수 있어요/)).toBeInTheDocument()
    expect(retry).not.toHaveAccessibleDescription(/응답을 읽지 못했어요/)
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)))
    const before = log.started.length
    fireEvent.click(within(notice).getByRole('button', { name: '새로고침' }))
    await until(() =>
      expect(log.started.slice(before)).toContainEqual({ method: 'GET', path: '/tasks/tk_04' }),
    )
  })

  it('재시도가 실패하면 그 이유를 버튼 가까이에 보이고 상태는 반영 실패 그대로다', async () => {
    taskOf('tk_04').notion_sync_status = 'failed'
    server.use(
      http.post('/api/v1/tasks/:taskId/notion-sync/retry', () =>
        fail('INTERNAL_ERROR', 'boom', 500),
      ),
    )
    const { log } = await openTask('tk_04', '배포 스크립트')
    const retry = screen.getByRole('button', { name: '다시 반영하기' })
    await userEvent.click(retry)
    await until(() =>
      expect(retry).toHaveAccessibleDescription(
        '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
      ),
    )
    expect(label()).toBe('반영 실패')
    await pause(1_200)
    expect(retries(log, 'tk_04')).toBe(1)
  })

  it('반영 상태가 없으면(null) 조회하지 않는다', async () => {
    const { log } = await openTask('tk_05', '회의록 요약 검수')
    expect(label()).toBe('반영 상태 없음')
    const first = taskGets(log, 'tk_05')
    await advance(15_000)
    await pause(150)
    expect(taskGets(log, 'tk_05')).toBe(first)
  })

  it('화면을 떠나면 멈춘다', async () => {
    taskOf('tk_04').notion_sync_status = 'pending'
    const { app, log } = await openTask('tk_04', '배포 스크립트')
    const first = taskGets(log, 'tk_04')
    act(() => app.navigate(paths.tasks('ws_01')))
    await screen.findByRole('heading', { level: 1, name: '태스크' })
    await advance(15_000)
    await pause(150)
    expect(taskGets(log, 'tk_04')).toBe(first)
  })

  it('접근을 잃으면(조회 403) 멈춘다', async () => {
    taskOf('tk_04').notion_sync_status = 'pending'
    const { log } = await openTask('tk_04', '배포 스크립트')
    const first = taskGets(log, 'tk_04')
    server.use(http.get('/api/v1/tasks/:taskId', () => fail('FORBIDDEN', '권한이 없습니다.', 403)))
    await advance(3_000)
    await until(() => expect(taskGets(log, 'tk_04')).toBe(first + 1))
    await advance(15_000)
    await pause(150)
    expect(taskGets(log, 'tk_04')).toBe(first + 1)
  })
})

describe('재조회 실패 안내 (#236)', () => {
  const NOTICE = '최신 상태를 받지 못했어요'
  const serverFails = () =>
    server.use(http.get('/api/v1/tasks/:taskId', () => fail('INTERNAL_ERROR', 'boom', 500)))
  const networkFails = () =>
    server.use(http.get('/api/v1/tasks/:taskId', () => HttpResponse.error()))
  const notices = () => screen.queryAllByText(NOTICE)
  const retryButton = () => screen.getByRole('button', { name: '다시 시도' })
  /** 다음 polling 이 실패하고 Query 기본 재시도(1초 뒤 1회)도 실패해 오류가 될 때까지 */
  async function failNextPoll() {
    await advance(3_000)
    return screen.findAllByText(NOTICE, {}, { timeout: 5_000 })
  }

  it.each([
    ['500', serverFails],
    ['네트워크 오류', networkFails],
  ] as const)(
    'polling 이 %s 로 실패하면 이전 상세·반영 상태를 둔 채 안내 하나이고 polling 은 멈춘다 (AC-03)',
    async (_, breakServer) => {
      taskOf('tk_04').notion_sync_status = 'pending'
      const { log } = await openTask('tk_04', '배포 스크립트')
      breakServer()
      const shown = await failNextPoll()
      expect(shown).toHaveLength(1)
      expect(shown[0]?.closest('[role="alert"]')).not.toBeNull()
      expect(screen.getByRole('heading', { level: 1, name: '배포 스크립트' })).toBeVisible()
      expect(label()).toBe('반영 중')
      expect(screen.queryByText('태스크를 불러오지 못했어요')).toBeNull()

      await pause(150)
      const stopped = taskGets(log, 'tk_04')
      await advance(15_000)
      await pause(150)
      expect(taskGets(log, 'tk_04')).toBe(stopped)
      expect(notices()).toHaveLength(1)
    },
  )

  it('다시 시도는 요청 중 비활성이고 연속 클릭해도 한 번만 보낸다. 성공하면 안내가 사라지고 pending 이면 polling 이 다시 돈다 (AC-04, AC-06)', async () => {
    taskOf('tk_04').notion_sync_status = 'pending'
    const { log } = await openTask('tk_04', '배포 스크립트')
    serverFails()
    await failNextPoll()
    await pause(150)

    const gate = deferred()
    server.use(
      http.get('/api/v1/tasks/:taskId', async () => {
        await gate.promise
        return ok(toTaskResponse(taskOf('tk_04')))
      }),
    )
    const before = taskGets(log, 'tk_04')
    const button = retryButton()
    act(() => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    await until(() => expect(retryButton()).toBeDisabled())
    expect(retryButton()).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(retryButton())
    await pause(100)
    expect(taskGets(log, 'tk_04')).toBe(before + 1)
    expect(notices()).toHaveLength(1)

    gate.resolve()
    await until(() => expect(notices()).toHaveLength(0))
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
    expect(taskGets(log, 'tk_04')).toBe(before + 1)

    await pause(150)
    const resumed = taskGets(log, 'tk_04')
    await advance(3_000)
    await until(() => expect(taskGets(log, 'tk_04')).toBe(resumed + 1))
  })

  it('다시 시도가 또 실패하면 안내가 남고 다시 시도할 수 있다. 서버가 돌아오면 사라진다 (AC-05)', async () => {
    taskOf('tk_04').notion_sync_status = 'pending'
    const { log } = await openTask('tk_04', '배포 스크립트')
    serverFails()
    await failNextPoll()
    await pause(150)

    fireEvent.click(retryButton())
    await until(() => expect(retryButton()).toBeDisabled())
    // 재시도(1초 뒤 1회)까지 실패하면 다시 눌러 볼 수 있다
    await waitFor(() => expect(retryButton()).toBeEnabled(), { timeout: 5_000 })
    expect(notices()).toHaveLength(1)
    expect(label()).toBe('반영 중')
    expect(screen.getByRole('heading', { level: 1, name: '배포 스크립트' })).toBeVisible()

    server.resetHandlers()
    await pause(150)
    const before = taskGets(log, 'tk_04')
    fireEvent.click(retryButton())
    await until(() => expect(notices()).toHaveLength(0))
    expect(taskGets(log, 'tk_04')).toBe(before + 1)
  })

  it.each([
    ['pm', 'synced', '반영됨', false],
    ['pm', 'failed', '반영 실패', true],
    ['member', 'synced', '반영됨', false],
    ['member', 'failed', '반영 실패', false],
  ] as const)(
    '%s 가 다시 시도해 %s 를 받으면 polling 이 멈추고, 다시 반영하기는 PM 에게만 보인다 (AC-06, AC-07)',
    async (role, next, text, retryVisible) => {
      setMockRole(role)
      taskOf('tk_04').notion_sync_status = 'pending'
      const { log } = await openTask('tk_04', '배포 스크립트')
      serverFails()
      await failNextPoll()
      await pause(150)
      expect(retryButton()).toBeEnabled()

      server.resetHandlers()
      taskOf('tk_04').notion_sync_status = next
      fireEvent.click(retryButton())
      await until(() => expect(label()).toBe(text))
      expect(notices()).toHaveLength(0)
      expect(screen.queryByRole('button', { name: '다시 반영하기' }) !== null).toBe(retryVisible)

      await pause(150)
      const stopped = taskGets(log, 'tk_04')
      await advance(15_000)
      await pause(150)
      expect(taskGets(log, 'tk_04')).toBe(stopped)
    },
  )
})

describe('승인 결과의 반영 상태 (AC-07)', () => {
  it('승인 직후 그 태스크를 받기 전에는 확인하는 중이라고 보이고, 받으면 반영 상태로 바꾼다', async () => {
    const approval = db.approvals.find(({ approval_id }) => approval_id === 'ap_02')!
    approval.payload.due_date = '2026-09-30'
    renderApp(paths.approval('ws_01', 'ap_02'))
    const approve = await screen.findByRole('button', { name: '승인' })
    await waitFor(() => expect(approve).toBeEnabled())
    const gate = deferred()
    server.use(
      http.get('/api/v1/tasks/:taskId', async () => {
        await gate.promise
        return undefined
      }),
    )
    await userEvent.click(approve)
    expect(await screen.findByText('확인하는 중이에요')).toBeInTheDocument()
    expect(screen.queryByTestId('notion-sync-status')).toBeNull()

    gate.resolve()
    await waitFor(() =>
      expect(screen.getByTestId('notion-sync-status')).toHaveTextContent('반영 중'),
    )
    expect(screen.queryByText('확인하는 중이에요')).toBeNull()
  })

  it('승인 성공 뒤 결과에 반영 중을 보이고, 실제 synced 가 올 때만 반영됨이다', async () => {
    const approval = db.approvals.find(({ approval_id }) => approval_id === 'ap_02')!
    approval.payload.due_date = '2026-09-30'
    const log = recordRequests()
    renderApp(paths.approval('ws_01', 'ap_02'))
    const approve = await screen.findByRole('button', { name: '승인' })
    await waitFor(() => expect(approve).toBeEnabled())
    await userEvent.click(approve)
    await waitFor(() =>
      expect(screen.getByTestId('notion-sync-status')).toHaveTextContent('반영 중'),
    )
    await pause(150)
    const first = taskGets(log, 'tk_90')
    expect(first).toBeGreaterThanOrEqual(1)

    await advance(2_999)
    await pause(100)
    expect(taskGets(log, 'tk_90')).toBe(first)
    expect(label()).toBe('반영 중')

    taskOf('tk_90').notion_sync_status = 'synced'
    await advance(1)
    await until(() => expect(label()).toBe('반영됨'))
    await advance(15_000)
    await pause(150)
    expect(taskGets(log, 'tk_90')).toBe(first + 1)
  })
})
