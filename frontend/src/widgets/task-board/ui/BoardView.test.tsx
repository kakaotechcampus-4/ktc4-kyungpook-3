import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { toTask } from '@/entities/task'
import type { Task } from '@/entities/task'
import { createQueryClient } from '@/shared/api/queryClient'
import { taskFixtures } from '@/shared/mock/fixtures/task'
import { toTaskResponse } from '@/shared/mock/task-state'
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

function renderBoard(props: Partial<BoardViewProps> = {}) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
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
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const cardTitles = () =>
  within(screen.getByRole('tabpanel'))
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

  it('넓은 화면은 탭 없이 세 칸을 나란히 둔다', () => {
    renderBoard({ compact: false })
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(
      screen.getAllByRole('region').map((region) => region.getAttribute('aria-label')),
    ).toEqual(['시작 전', '진행 중', '완료'])
  })
})
