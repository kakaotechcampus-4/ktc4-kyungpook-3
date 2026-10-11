import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { paths } from '@/shared/config/routes'
import { fail } from '@/shared/mock/envelope'
import { MOCK_TODAY } from '@/shared/mock/fixtures/constants'
import type { BoardQuery } from '../lib/taskBoard'
import { DEFAULT_VIEW_QUERY } from '../lib/taskViews'
import type { ViewQuery } from '../lib/taskViews'
import { TaskBoard } from './TaskBoard'
import type { TaskBoardProps } from './TaskBoard'

/*
 * 태스크 목록 (M6 §3, §5-1). ws_01 하나에 로그인한 상태 — 픽스처 태스크 10건(미완료 7 · 완료 3), 대기 생성 승인 3건.
 * 페이지처럼 탭·날짜 조건을 상태로 들고 있다(실제 화면은 URL). 오늘은 픽스처의 서울 오늘(2026-09-18)로 고정한다.
 * 역할은 widget 의 `isPm` 과 시나리오(tasks-member 는 서버 쓰기 403) 둘 다 맞춘다.
 */

function BoardWithQuery(props: TaskBoardProps) {
  const [query, setQuery] = useState<BoardQuery>(props.query)
  const [view, setView] = useState<ViewQuery>(props.view)
  return (
    <TaskBoard
      {...props}
      query={query}
      onQueryChange={setQuery}
      view={view}
      onViewChange={setView}
    />
  )
}

const meta = {
  title: 'M6 태스크/목록',
  component: TaskBoard,
  render: (args) => <BoardWithQuery {...args} />,
  args: {
    workspaceId: 'ws_01',
    isPm: true,
    query: { tab: 'all', due: [] },
    today: MOCK_TODAY,
    onQueryChange: () => {},
    view: DEFAULT_VIEW_QUERY,
    onViewChange: () => {},
  },
  parameters: { scenario: 'tasks-default', route: '/workspaces/ws_01/tasks' },
} satisfies Meta<typeof TaskBoard>

export default meta
type Story = StoryObj<typeof meta>

const tabNames = (canvasElement: HTMLElement) =>
  within(canvasElement)
    .getAllByRole('tab')
    .map((tab) => tab.textContent)

/** PM — 대기 승인 3건이 태스크 앞에 오고, 탭 개수는 목록과 같은 판정이다 */
export const PM_기본: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = await canvas.findByRole('list', { name: '태스크 목록' })
    await expect(tabNames(canvasElement)).toEqual(['전체 13', '확인 필요 3', '진행 중 7', '완료 3'])
    // 확인 필요는 시안처럼 목록 안 카드로 먼저, 태스크는 그 아래 행이다
    const cards = within(canvas.getByRole('list', { name: '확인 필요 목록' })).getAllByRole(
      'article',
    )
    await expect(cards).toHaveLength(3)
    await expect(cards.every((card) => card.dataset.kind === 'approval')).toBe(true)
    await expect(within(cards[0]).getByRole('link', { name: '알림 문구 검토' })).toHaveAttribute(
      'href',
      paths.approval('ws_01', 'ap_01'),
    )
    await expect(within(list).getAllByRole('listitem')).toHaveLength(10)
  },
}

/** 일반 팀원(권한) — 확인 필요 탭과 대기 승인이 없다. 승인 목록은 부르지 않는다 */
export const 팀원: Story = {
  args: { isPm: false },
  parameters: { scenario: 'tasks-member' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('list', { name: '태스크 목록' })
    await expect(tabNames(canvasElement)).toEqual(['전체 10', '진행 중 7', '완료 3'])
    await expect(canvas.queryByText('확인 필요')).toBeNull()
  },
}

/** 키보드 — 화살표·Home·End 로 탭을 옮기면 그 탭이 골라지고 포커스가 따라간다 */
export const 탭_키보드: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('list', { name: '태스크 목록' })
    const all = canvas.getByRole('tab', { name: /^전체/ })
    all.focus()
    await userEvent.keyboard('{ArrowRight}')
    const review = canvas.getByRole('tab', { name: /^확인 필요/ })
    await expect(review).toHaveFocus()
    await expect(review).toHaveAttribute('aria-selected', 'true')
    await expect(
      within(await canvas.findByRole('list', { name: '확인 필요 목록' })).getAllByRole('article'),
    ).toHaveLength(3)
    await userEvent.keyboard('{End}')
    await expect(canvas.getByRole('tab', { name: /^완료/ })).toHaveFocus()
    await userEvent.keyboard('{Home}')
    await expect(all).toHaveFocus()
    await expect(all).toHaveAttribute('aria-selected', 'true')
  },
}

/** 날짜 조건으로 비었다 — 조건 해제 액션이 있다 */
export const 날짜_조건_빈_결과: Story = {
  args: { query: { tab: 'done', due: ['overdue'] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('조건에 맞는 항목이 없어요')).toBeInTheDocument()
    const clear = canvas.getAllByRole('button', { name: '날짜 조건 해제' })
    await expect(clear.length).toBeGreaterThan(0)
  },
}

/** 태스크·승인이 하나도 없다 */
export const 빈_목록: Story = {
  parameters: { scenario: 'tasks-empty' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('아직 태스크가 없어요')).toBeInTheDocument()
    await expect(tabNames(canvasElement)).toEqual(['전체 0', '확인 필요 0', '진행 중 0', '완료 0'])
  },
}

/** 태스크 목록이 늦다 — 탭은 개수 없이, 본문은 스켈레톤 */
export const 로딩: Story = {
  parameters: {
    msw: [
      http.get('/api/v1/tasks', async () => {
        await delay('infinite')
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('tab', { name: '전체' })).toBeInTheDocument()
    await expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull()
    await expect(canvas.queryByRole('list', { name: '태스크 목록' })).toBeNull()
  },
}

/** 태스크 목록 조회 실패 — 다시 시도. 400 은 다시 묻지 않아 바로 오류가 보인다(5xx 는 1초 뒤 한 번 더) */
export const 오류: Story = {
  parameters: {
    msw: [http.get('/api/v1/tasks', () => fail('INVALID_REQUEST', 'x', 400))],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('태스크 목록을 불러오지 못했어요')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  },
}
