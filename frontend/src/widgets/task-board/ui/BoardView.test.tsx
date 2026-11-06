import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { toTask } from '@/entities/task'
import type { Task } from '@/entities/task'
import { createQueryClient } from '@/shared/api/queryClient'
import { taskFixtures } from '@/shared/mock/fixtures/task'
import { server } from '@/shared/mock/server'
import { toTaskResponse } from '@/shared/mock/task-state'
import type { BoardColumnKey } from '../lib/taskViews'
import { BoardView } from './BoardView'
import type { BoardViewProps } from './BoardView'

/*
 * 휴대폰 보드 (PwaTasks 시안, D-180). 폭 판정은 페이지가 하고 보드는 `compact` 만 받는다.
 * 오늘 2026-09-18 — 9/17 이전 마감은 기한 지남(위험)이다.
 */
const TODAY = '2026-09-18'

function task(id: string, title: string, status: Task['status'], dueDate: string | null): Task {
  return { ...toTask(toTaskResponse(taskFixtures[0])), id, title, status, dueDate }
}

const TASKS = [
  task('tk_a', '기획서 초안', 'todo', '2026-10-01'),
  task('tk_b', 'STT 정확도 측정', 'in_progress', '2026-09-17'),
  task('tk_c', 'DB 스키마 정리', 'blocked', '2026-09-15'),
  task('tk_d', '로그인 API 연동', 'in_progress', '2026-10-02'),
  task('tk_e', '랜딩 카피', 'done', '2026-09-12'),
]

type BoardProps = Omit<Partial<BoardViewProps>, 'column' | 'onColumnChange'>

/** 페이지처럼 고른 칸을 보드 밖에 두고 바꾼다. 받은 변경은 `changes` 에 적는다 */
let changes: { column: BoardColumnKey; replace: boolean }[] = []
beforeEach(() => {
  changes = []
})

function Board(props: BoardProps) {
  const [column, setColumn] = useState<BoardColumnKey>('active')
  return (
    <BoardView
      workspaceId="ws_01"
      tasks={TASKS}
      names={new Map()}
      today={TODAY}
      period="all"
      sort="due"
      pendingApprovals={0}
      canCreate={false}
      assignee={null}
      compact
      {...props}
      column={column}
      onColumnChange={(next, options) => {
        changes.push({ column: next, replace: options?.replace ?? false })
        setColumn(next)
      }}
    />
  )
}

/** 같은 보드 인스턴스에 다른 props 를 주려면 `rerenderWith` 를 쓴다 — 폭이 바뀐 것과 같다 */
function renderBoard(props: BoardProps = {}) {
  const client = createQueryClient()
  const tree = (next: BoardProps) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Board {...next} />
      </MemoryRouter>
    </QueryClientProvider>
  )
  const view = render(tree(props))
  return { ...view, rerenderWith: (next: BoardProps) => view.rerender(tree({ ...props, ...next })) }
}

/** `POST /tasks` 본문을 적는다. 응답은 보지 않는다 */
function recordCreates() {
  const bodies: unknown[] = []
  server.use(
    http.post('/api/v1/tasks', async ({ request }) => {
      bodies.push(await request.json())
      return HttpResponse.json({ code: 'TEST_STOP', message: 'stop' }, { status: 500 })
    }),
  )
  return bodies
}

const panel = () => screen.getByRole('tabpanel')
const tab = (name: string) => screen.getByRole('tab', { name })
const cardTitles = () =>
  within(panel())
    .getAllByRole('link')
    .map((link) => link.textContent)

describe('휴대폰 보드 — 칸 고르기 (PwaTasks 시안)', () => {
  it('칸 셋이 개수와 함께 탭이고, 처음에는 진행 중 칸만 그 요약 줄과 함께 보인다', () => {
    renderBoard()
    const tabs = within(screen.getByRole('tablist', { name: '상태' })).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['시작 전 1', '진행 중 3', '완료 1'])
    expect(screen.getByRole('tab', { name: '진행 중 3' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('region', { name: '시작 전' })).toBeNull()

    const panel = screen.getByRole('tabpanel', { name: '진행 중 3' })
    expect(within(panel).getByText('막힘 1 · 위험 2 · 마감 빠른 순')).toBeVisible()
    expect(cardTitles()).toEqual(['DB 스키마 정리', 'STT 정확도 측정', '로그인 API 연동'])
  })

  it('탭을 누르면 그 칸의 카드만 보이고, 완료 칸 요약은 완료 칸의 순서를 말한다', async () => {
    renderBoard()
    await userEvent.click(screen.getByRole('tab', { name: '완료 1' }))
    expect(screen.getByRole('tab', { name: '완료 1' })).toHaveAttribute('aria-selected', 'true')
    expect(cardTitles()).toEqual(['랜딩 카피'])
    expect(within(screen.getByRole('tabpanel')).getByText('최근 완료순')).toBeVisible()
  })

  it('화살표·Home 으로 옮기면 옮긴 탭을 바로 고르고 포커스도 옮긴다', async () => {
    renderBoard()
    screen.getByRole('tab', { name: '진행 중 3' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '완료 1' })).toHaveFocus()
    expect(cardTitles()).toEqual(['랜딩 카피'])
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '시작 전 1' })).toHaveFocus()
    expect(cardTitles()).toEqual(['기획서 초안'])
  })

  it('PM 은 고른 칸에 그 칸 이름의 `직접 추가` 가 있다', async () => {
    renderBoard({ canCreate: true })
    expect(
      within(screen.getByRole('tabpanel')).getByRole('button', { name: /진행 중/ }),
    ).toBeVisible()
    await userEvent.click(screen.getByRole('tab', { name: '시작 전 1' }))
    expect(
      within(screen.getByRole('tabpanel')).getByRole('button', { name: /시작 전/ }),
    ).toBeVisible()
  })

  it('칸을 바꿔도 쓰던 직접 추가는 처음 칸에 남고, 돌아와 보내면 그 칸의 상태로 만든다', async () => {
    const user = userEvent.setup()
    const bodies = recordCreates()
    renderBoard({ canCreate: true })
    await user.click(within(panel()).getByRole('button', { name: '진행 중에 직접 추가' }))
    await user.type(screen.getByRole('textbox', { name: '진행 중 새 태스크 제목' }), '회고 정리')

    await user.click(tab('완료 1'))
    expect(within(panel()).queryByRole('textbox')).toBeNull()
    expect(within(panel()).getByRole('button', { name: '완료에 직접 추가' })).toBeVisible()

    await user.click(tab('진행 중 3'))
    const input = within(panel()).getByRole('textbox', { name: '진행 중 새 태스크 제목' })
    expect(input).toHaveValue('회고 정리')
    await user.type(input, '{Enter}')
    await waitFor(() =>
      expect(bodies).toEqual([
        { workspace_id: 'ws_01', title: '회고 정리', status: 'in_progress' },
      ]),
    )
  })

  it('768px 경계를 오가도 쓰던 제목과 입력 포커스가 그대로다', async () => {
    const user = userEvent.setup()
    const board = renderBoard({ canCreate: true })
    await user.click(within(panel()).getByRole('button', { name: '진행 중에 직접 추가' }))
    await user.type(screen.getByRole('textbox', { name: '진행 중 새 태스크 제목' }), '초안')

    board.rerenderWith({ compact: false })
    const wide = within(screen.getByRole('region', { name: '진행 중' })).getByRole('textbox')
    expect(wide).toHaveValue('초안')
    expect(wide).toHaveFocus()

    board.rerenderWith({ compact: true })
    const narrow = within(panel()).getByRole('textbox', { name: '진행 중 새 태스크 제목' })
    expect(narrow).toHaveValue('초안')
    expect(narrow).toHaveFocus()
    expect(changes).toEqual([])
  })

  it('넓은 화면에서 진행 중이 아닌 칸에 포커스가 있으면, 좁아질 때 그 칸을 고르되 기록은 고친다(replace)', async () => {
    const user = userEvent.setup()
    const board = renderBoard({ canCreate: true, compact: false })
    const done = screen.getByRole('region', { name: '완료' })
    await user.click(within(done).getByRole('button', { name: '완료에 직접 추가' }))
    await user.type(within(done).getByRole('textbox'), '초안')

    board.rerenderWith({ compact: true })
    expect(tab('완료 1')).toHaveAttribute('aria-selected', 'true')
    const input = within(panel()).getByRole('textbox', { name: '완료 새 태스크 제목' })
    expect(input).toHaveValue('초안')
    expect(input).toHaveFocus()
    expect(changes).toEqual([{ column: 'done', replace: true }])
  })

  it('칸 고르기 탭에 포커스가 있을 때 넓어지면 포커스는 그 칸으로 가고, 떠나면 칸은 Tab 자리가 아니다', async () => {
    const user = userEvent.setup()
    const board = renderBoard()
    await user.click(tab('완료 1'))
    expect(tab('완료 1')).toHaveFocus()
    expect(changes).toEqual([{ column: 'done', replace: false }])

    board.rerenderWith({ compact: false })
    const done = screen.getByRole('region', { name: '완료' })
    expect(done).toHaveFocus()
    await user.tab()
    expect(within(done).getByRole('link', { name: '랜딩 카피' })).toHaveFocus()
    expect(done).not.toHaveAttribute('tabindex')
  })

  it('카드도 직접 추가도 없는 칸은 패널이 Tab 자리다', async () => {
    renderBoard({ tasks: TASKS.filter(({ status }) => status !== 'done') })
    await userEvent.click(tab('완료 0'))
    expect(panel()).toHaveAttribute('tabindex', '0')
    await userEvent.click(tab('진행 중 3'))
    expect(panel()).not.toHaveAttribute('tabindex')
  })

  it('넓은 화면은 탭 없이 세 칸을 나란히 둔다', () => {
    renderBoard({ compact: false })
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(
      screen.getAllByRole('region').map((region) => region.getAttribute('aria-label')),
    ).toEqual(['시작 전', '진행 중', '완료'])
  })
})
