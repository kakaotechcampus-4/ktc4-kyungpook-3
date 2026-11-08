import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { getResponse, http } from 'msw'
import { onTestFinished } from 'vitest'
import { paths } from '@/shared/config/routes'
import { db } from '@/shared/mock/db'
import { handlers } from '@/shared/mock/handlers'
import { applyScenario } from '@/shared/mock/scenarios'
import { server } from '@/shared/mock/server'
import { setMockRole } from '@/shared/mock/sessions'
import { SILENCE_BLOCKER, blockBySilence, updateTask } from '@/shared/mock/task-state'
import { deferred } from '@/shared/test/deferred'
import { recordRequests } from '@/shared/test/requests'
import type { RecordedRequest } from '@/shared/test/requests'
import { renderApp } from './test/renderApp'

beforeEach(() => applyScenario('notifications-default'))

const AUTO_NOTICE = '리마인드에 응답이 없어 자동으로 막혔어요.'

const mockTask = (taskId: string) => db.tasks.find(({ task_id }) => task_id === taskId)!

function editBlockerAfterAutoBlock(taskId: string) {
  updateTask(mockTask(taskId), { blocker: '카톡으로 들었어요' }, 'mb_01')
}

function reblockAfterAutoBlock(taskId: string) {
  const task = mockTask(taskId)
  if (task.status !== 'blocked') blockBySilence(task, '2026-09-18T08:30:00+09:00')
  updateTask(task, { status: 'in_progress' }, 'mb_01')
  updateTask(task, { status: 'blocked' }, 'mb_01')
}

const perTaskReads = (requests: readonly RecordedRequest[]) =>
  requests.filter(({ method, path }) => method === 'GET' && /^\/tasks\/[^/?]+/.test(path))

const listReads = (requests: readonly RecordedRequest[]) =>
  requests.filter(({ method, path }) => method === 'GET' && path === '/tasks?workspace_id=ws_01')

describe('태스크 상세의 자동 막힘 (#330, #365)', () => {
  function field(term: string): HTMLElement {
    return within(screen.getByLabelText('태스크 정보')).getByText(term, { selector: 'dt' })
      .nextElementSibling as HTMLElement
  }
  const blockerShown = () =>
    within(screen.getByLabelText('태스크 정보')).queryByText('막힌 사유', { selector: 'dt' }) !==
    null

  async function openDetail(taskId: string, title: string) {
    const app = renderApp(paths.tasks('ws_01', taskId))
    await screen.findByRole('heading', { level: 1, name: title })
    return app
  }

  it('PM 이 막힘을 풀면 상태가 막히기 전 값으로 돌아가 막힌 사유 줄이 사라지고 알린다', async () => {
    const user = userEvent.setup()
    await openDetail('tk_06', 'STT 정확도 측정')
    expect(await within(field('막힌 사유')).findByText(AUTO_NOTICE)).toBeInTheDocument()

    await user.click(within(field('막힌 사유')).getByRole('button', { name: '막힘 풀기' }))

    await waitFor(() => expect(screen.getByTestId('task-status')).toHaveTextContent('진행 중'))
    expect(blockerShown()).toBe(false)
    expect(screen.queryByText(AUTO_NOTICE)).toBeNull()
    expect(await screen.findByText('자동 막힘을 풀었어요')).toBeInTheDocument()
  })

  it('일반 팀원은 자동 막힘만 보고 풀 수 없다', async () => {
    setMockRole('member')
    await openDetail('tk_06', 'STT 정확도 측정')
    expect(await within(field('막힌 사유')).findByText(AUTO_NOTICE)).toBeInTheDocument()
    expect(within(field('막힌 사유')).queryByRole('button', { name: '막힘 풀기' })).toBeNull()
  })

  it('사람이 건 막힘은 사유가 스케줄러 문구여도 자동 막힘이 아니다', async () => {
    mockTask('tk_03').blocker = SILENCE_BLOCKER
    await openDetail('tk_03', 'DB 스키마 정리')
    expect(field('막힌 사유')).toHaveTextContent(SILENCE_BLOCKER)
    expect(screen.queryByText(AUTO_NOTICE)).toBeNull()
    expect(screen.queryByRole('button', { name: '막힘 풀기' })).toBeNull()
  })

  it('자동 막힘 뒤 사람이 상태를 바꿨다가 다시 막았으면 이력과 달리 자동 막힘이고 풀 수 있다', async () => {
    const user = userEvent.setup()
    reblockAfterAutoBlock('tk_06')
    await openDetail('tk_06', 'STT 정확도 측정')

    await user.click(await within(field('막힌 사유')).findByRole('button', { name: '막힘 풀기' }))

    await waitFor(() => expect(screen.getByTestId('task-status')).toHaveTextContent('진행 중'))
    expect(blockerShown()).toBe(false)
  })

  it('막힌 뒤 값이 바뀌어 409 면 안내하고 태스크를 다시 불러온다', async () => {
    const user = userEvent.setup()
    await openDetail('tk_06', 'STT 정확도 측정')
    const undo = await within(field('막힌 사유')).findByRole('button', { name: '막힘 풀기' })
    // 화면이 모르는 사이 다른 PM 이 사유를 고쳤다
    editBlockerAfterAutoBlock('tk_06')

    await user.click(undo)

    expect(await screen.findByText('막힘을 풀지 못했어요')).toBeInTheDocument()
    expect(
      screen.getByText(
        '막힌 뒤 상태나 사유가 바뀌어 되돌릴 수 없어요. 최신 태스크를 다시 불러왔어요.',
      ),
    ).toBeInTheDocument()
    await waitFor(() => expect(field('막힌 사유')).toHaveTextContent('카톡으로 들었어요'))
    expect(screen.getByTestId('task-status')).toHaveTextContent('막힘')
    expect(screen.queryByText(AUTO_NOTICE)).toBeNull()
  })
})

describe('보드의 자동 막힘 배지 (#330, #365)', () => {
  const card = (title: string) =>
    screen.getByRole('link', { name: title }).closest('article') as HTMLElement
  const badge = (title: string) =>
    within(card(title)).queryByRole('button', { name: /막힌 사유 보기$/ })

  async function openBoard() {
    renderApp(`${paths.tasks('ws_01')}?view=board`)
    await waitFor(() => expect(badge('STT 정확도 측정')).not.toBeNull())
  }

  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 80)))

  it('막힌 카드가 여럿이어도 카드마다 태스크·이력을 따로 받지 않는다', async () => {
    reblockAfterAutoBlock('tk_01')
    const log = recordRequests()
    await openBoard()
    await settle()

    expect(badge('STT 정확도 측정')).toHaveAccessibleName('자동 막힘, 막힌 사유 보기')
    expect(badge('로그인 API 연동')).toHaveAccessibleName('자동 막힘, 막힌 사유 보기')
    expect(badge('DB 스키마 정리')).toHaveAccessibleName('막힘, 막힌 사유 보기')
    expect(listReads(log.started)).toHaveLength(1)
    expect(perTaskReads(log.started)).toEqual([])
  })

  it('배지는 이력이 아니라 응답의 auto_blocked 를 따른다', async () => {
    editBlockerAfterAutoBlock('tk_06')
    reblockAfterAutoBlock('tk_01')
    await openBoard()

    expect(badge('STT 정확도 측정')).toHaveAccessibleName('막힘, 막힌 사유 보기')
    expect(badge('로그인 API 연동')).toHaveAccessibleName('자동 막힘, 막힌 사유 보기')
  })

  it('PM 이 사유 창에서 풀면 목록을 다시 받기 전에 카드가 막히기 전 상태로 바뀐다', async () => {
    const user = userEvent.setup()
    const log = recordRequests()
    await openBoard()
    expect(
      within(card('DB 스키마 정리')).getByRole('button', { name: '막힘, 막힌 사유 보기' }),
    ).toBeVisible()

    const heldListRefetch = deferred()
    onTestFinished(() => heldListRefetch.resolve())
    server.use(
      http.get('/api/v1/tasks', async ({ request }) => {
        const copy = request.clone()
        await heldListRefetch.promise
        return getResponse(handlers, copy)
      }),
    )
    await user.click(badge('STT 정확도 측정')!)
    const dialog = await screen.findByRole('dialog', { name: '막힌 사유' })
    expect(dialog).toHaveTextContent(SILENCE_BLOCKER)
    await user.click(within(dialog).getByRole('button', { name: '막힘 풀기' }))

    await waitFor(() => expect(badge('STT 정확도 측정')).toBeNull())
    const undone = log.timeline.indexOf('answer POST /tasks/tk_06/auto-block/undo')
    expect(listReads(log.started)).toHaveLength(2)
    expect(log.timeline.slice(undone)).not.toContain('answer GET /tasks?workspace_id=ws_01')
    expect(perTaskReads(log.started)).toEqual([])
  })

  it('PM 이 풀 때 409 면 목록을 다시 받아 배지를 고친다', async () => {
    const user = userEvent.setup()
    const log = recordRequests()
    await openBoard()
    await user.click(badge('STT 정확도 측정')!)
    const dialog = await screen.findByRole('dialog', { name: '막힌 사유' })
    editBlockerAfterAutoBlock('tk_06')

    await user.click(within(dialog).getByRole('button', { name: '막힘 풀기' }))

    expect(await screen.findByText('막힘을 풀지 못했어요')).toBeInTheDocument()
    await waitFor(() =>
      expect(badge('STT 정확도 측정')).toHaveAccessibleName('막힘, 막힌 사유 보기'),
    )
    const refused = log.timeline.indexOf('answer POST /tasks/tk_06/auto-block/undo')
    expect(log.timeline.slice(refused)).toContain('answer GET /tasks?workspace_id=ws_01')
  })
})
