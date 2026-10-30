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
 * 태스크 보기 — 보드·캘린더·간트 (M8 A). ws_01 하나에 로그인한 상태 — 픽스처 태스크 10건, 대기 생성 승인 3건(ap_03 만 마감 9/25).
 * 오늘은 픽스처의 서울 오늘(2026-09-18)이라 캘린더·간트는 그 달·그 주에서 연다. 페이지처럼 보기를 상태로 들고 있다(실제 화면은 URL).
 * 태스크 조회만 보기 전체 오류다. 확인 필요·팀원·회의를 받지 못하면 받은 데이터로 그린 보기 위에서 알린다 (AC-A-05).
 */

function ViewsWithQuery(props: TaskBoardProps) {
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
  title: 'M8 태스크/보기',
  component: TaskBoard,
  render: (args) => <ViewsWithQuery {...args} />,
  args: {
    workspaceId: 'ws_01',
    isPm: true,
    query: { tab: 'all', due: [] },
    today: MOCK_TODAY,
    onQueryChange: () => {},
    view: { ...DEFAULT_VIEW_QUERY, view: 'board' },
    onViewChange: () => {},
  },
  parameters: { scenario: 'tasks-default', route: '/workspaces/ws_01/tasks' },
} satisfies Meta<typeof TaskBoard>

export default meta
type Story = StoryObj<typeof meta>

const calendar = { ...DEFAULT_VIEW_QUERY, view: 'calendar' } as const
const gantt = { ...DEFAULT_VIEW_QUERY, view: 'gantt' } as const
/** 보기 코드는 lazy 다 — 처음 그릴 때 기본 1초를 넘길 수 있다 */
const LOADED = { timeout: 5_000 }

/** 보드 PM — 승인이 끝난 태스크만 세 칸이고, 확인 필요는 리스트에서 승인하라고 알린다 */
export const 보드_PM: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const done = await canvas.findByRole('region', { name: '완료' }, LOADED)
    await expect(canvas.getByRole('region', { name: '시작 전' })).toBeVisible()
    await expect(within(done).getByRole('link', { name: '랜딩 카피' })).toHaveAttribute(
      'href',
      paths.tasks('ws_01', 'tk_08'),
    )
    await expect(canvas.getByText(/리스트 뷰에서 승인하면 이 보드로 넘어옵니다/)).toBeVisible()
    await expect(canvas.queryByRole('alert')).toBeNull()
  },
}

/** 캘린더 PM — 마감일 칸에 태스크·확인 필요·회의가 놓이고, 마감 없는 일은 아래에 모인다 */
export const 캘린더_PM: Story = {
  args: { view: calendar },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const grid = await canvas.findByRole('grid', { name: '2026년 9월' }, LOADED)
    const day = within(grid).getByRole('gridcell', { name: '2026-09-25' })
    await expect(within(day).getByRole('link', { name: /배포 문서 보완/ })).toHaveAttribute(
      'href',
      `${paths.tasks('ws_01')}?tab=needs_review`,
    )
    await expect(canvas.getByRole('region', { name: '마감일 없음' })).toHaveTextContent(
      '회의록 요약 검수',
    )
  },
}

/** 간트 PM — 팀원별 묶음에 막대가 놓이고, 일정이 없는 일은 아래 목록이다 */
export const 간트_PM: Story = {
  args: { view: gantt },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('table', { name: '일정' }, LOADED)
    await expect(canvas.getByRole('row', { name: /배포 문서 보완/ })).toBeVisible()
    await expect(canvas.getByRole('region', { name: '일정이 없는 일' })).toHaveTextContent(
      '알림 문구 검토',
    )
  },
}

/** 일반 팀원 — 세 보기 어디에도 확인 필요가 없다. 승인 목록은 부르지 않는다 */
export const 간트_팀원: Story = {
  args: { isPm: false, view: gantt },
  parameters: { scenario: 'tasks-member' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('table', { name: '일정' }, LOADED)
    await expect(canvas.queryByText(/배포 문서 보완|알림 문구 검토|테스트 계획 정리/)).toBeNull()
  },
}

/** 태스크를 받는 중 — 보기 자리에 `태스크를 불러오는 중` 이 있고 보기는 아직 없다 */
export const 조회_대기: Story = {
  args: { view: calendar },
  parameters: {
    msw: [
      http.get('/api/v1/tasks', async () => {
        await delay('infinite')
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('status', { name: '태스크를 불러오는 중' }),
    ).toBeInTheDocument()
    await expect(canvas.queryByRole('grid')).toBeNull()
  },
}

/** 태스크·확인 필요가 하나도 없다 — 빈 격자 대신 빈 상태다 */
export const 빈_응답: Story = {
  args: { view: gantt },
  parameters: { scenario: 'tasks-empty' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('아직 태스크가 없어요', undefined, LOADED)).toBeVisible()
    await expect(canvas.queryByRole('table')).toBeNull()
  },
}

/** 태스크 조회 실패 — 보기 전체 오류와 다시 시도. 400 은 다시 묻지 않아 바로 보인다 */
export const 조회_실패: Story = {
  parameters: {
    msw: [http.get('/api/v1/tasks', () => fail('INVALID_REQUEST', 'x', 400))],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('태스크 목록을 불러오지 못했어요')).toBeVisible()
    await expect(canvas.getByRole('button', { name: '다시 시도' })).toBeVisible()
    await expect(canvas.queryByRole('region', { name: '시작 전' })).toBeNull()
  },
}

/** 팀원 조회 실패 — 보드는 그대로이고 담당자는 `알 수 없는 담당자` 다. 위에서 알리고 다시 시도할 수 있다 */
export const 부분_실패_팀원: Story = {
  parameters: {
    msw: [http.get('/api/v1/members', () => fail('INVALID_REQUEST', 'x', 400))],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('region', { name: '시작 전' }, LOADED)
    const alert = canvas.getByRole('alert')
    await expect(alert).toHaveTextContent('팀원 정보를 불러오지 못했어요')
    await expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeEnabled()
    await expect(canvas.getAllByText('알 수 없는 담당자').length).toBeGreaterThan(0)
  },
}

/** 확인 필요 조회 실패(PM) — 간트는 태스크로 그리고 확인 필요가 빠졌다고 알린다 */
export const 부분_실패_확인_필요: Story = {
  args: { view: gantt },
  parameters: {
    msw: [http.get('/api/v1/approvals', () => fail('INVALID_REQUEST', 'x', 400))],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('table', { name: '일정' }, LOADED)
    await expect(canvas.getByRole('alert')).toHaveTextContent('확인 필요 정보를 불러오지 못했어요')
    await expect(canvas.queryByRole('row', { name: /배포 문서 보완/ })).toBeNull()
  },
}

/** 회의 조회 실패 — 캘린더는 태스크로 그리고 회의가 빠졌다고 알린다 */
export const 부분_실패_회의: Story = {
  args: { view: calendar },
  parameters: {
    msw: [
      http.get('/api/v1/workspaces/:workspaceId/meetings', () => fail('INVALID_REQUEST', 'x', 400)),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('grid', { name: '2026년 9월' }, LOADED)
    await expect(canvas.getByRole('alert')).toHaveTextContent('회의 정보를 불러오지 못했어요')
  },
}

/** 마감이 없는 달 — 격자는 그대로 두고 그렇다고 알린다. 앞 달로 돌아가면 사라진다 */
export const 캘린더_빈_달: Story = {
  args: { view: { ...calendar, month: '2026-10' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('grid', { name: '2026년 10월' }, LOADED)
    await expect(canvas.getByText('이 달에는 마감인 일이 없어요.')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: '이전 달' }))
    await canvas.findByRole('grid', { name: '2026년 9월' })
    await expect(canvas.queryByText('이 달에는 마감인 일이 없어요.')).toBeNull()
  },
}

/** 긴 제목·줄바꿈할 곳이 없는 제목·긴 담당자 이름 — 간트 왼쪽 칸은 252px 를 지키고 말줄임이다 */
export const 간트_긴_내용: Story = {
  args: { view: gantt },
  parameters: { scenario: 'tasks-long-content' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('table', { name: '일정' }, LOADED)
    const row = canvas.getByRole('row', { name: /^ABCDEFGHIJ/ })
    await expect(row.firstElementChild?.getBoundingClientRect().width).toBe(252)
  },
}
