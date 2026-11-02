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

    // 시안(TasksBoard) 값 — 블록 사이 22px, 필터 높이 36px
    const header = canvas.getByRole('heading', { level: 1, name: '태스크' }).closest('header')!
    const assignee = canvas.getByRole('button', { name: /^담당자:/ })
    const filterBox = assignee.getBoundingClientRect()
    await expect(filterBox.top - header.getBoundingClientRect().bottom).toBe(22)
    await expect(filterBox.height).toBe(36)
    // 칸 머리 표식은 2px 둥글기의 8px 네모 — 시작 전은 1.5px 실선 #BDBDBD, 완료는 #E8E8E8 면에 흐린 제목
    const markOf = (name: string) =>
      getComputedStyle(canvas.getByRole('heading', { name }).previousElementSibling!)
    // (1.5px 테두리 폭은 Chromium 이 기기 픽셀로 내려 1px 로 계산하므로 폭은 보지 않는다 — 시안 HTML 도 같다)
    const todoMark = markOf('시작 전')
    await expect([
      todoMark.borderTopStyle,
      todoMark.borderTopColor,
      todoMark.borderTopLeftRadius,
    ]).toEqual(['solid', 'rgb(189, 189, 189)', '2px'])
    await expect(markOf('완료').backgroundColor).toBe('rgb(232, 232, 232)')
    await expect(getComputedStyle(canvas.getByRole('heading', { name: '완료' })).color).toBe(
      'rgb(102, 102, 102)',
    )
    // 진행 중 칸의 카드는 모두 강조 테두리 #C9C9C9
    const activeCards = within(canvas.getByRole('region', { name: '진행 중' })).getAllByRole(
      'article',
    )
    await expect(activeCards.length).toBeGreaterThan(0)
    for (const card of activeCards)
      await expect(getComputedStyle(card).borderTopColor).toBe('rgb(201, 201, 201)')
  },
}

/**
 * 보드 직접 추가(PM) — 칸 아래 점선 `직접 추가` 를 누르면 그 자리에서 제목을 받는다. 서버(MSW `POST /tasks`)가 만든 뒤에
 * 그 칸의 기본 상태(진행 중)로 카드가 생기고 입력이 닫힌다
 */
export const 보드_직접_추가: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const active = await canvas.findByRole('region', { name: '진행 중' }, LOADED)
    await userEvent.click(within(active).getByRole('button', { name: '진행 중에 직접 추가' }))
    const input = within(active).getByRole('textbox', { name: '진행 중 새 태스크 제목' })
    await expect(input).toHaveFocus()
    // 입력에 포커스가 있으면 펼친 틀의 테두리 위에 2px 먹 outline 이 겹친다 (전역 포커스 규칙과 같은 모양)
    const form = within(active).getByRole('form', { name: '진행 중에 직접 추가' })
    const ring = getComputedStyle(form)
    await expect([
      ring.outlineStyle,
      ring.outlineWidth,
      ring.outlineColor,
      ring.outlineOffset,
    ]).toEqual(['solid', '2px', 'rgb(23, 23, 23)', '-1px'])
    await expect(within(active).getByRole('button', { name: '추가' })).toBeDisabled()
    await userEvent.type(input, '배포 체크리스트{Enter}')
    await expect(await within(active).findByRole('link', { name: '배포 체크리스트' })).toBeVisible()
    await expect(within(active).queryByRole('textbox')).toBeNull()
  },
}

/** 직접 추가 실패 — 입력을 남긴 채 칸 안에서 알리고 카드를 만들지 않는다 */
export const 보드_직접_추가_실패: Story = {
  parameters: {
    msw: [http.post('/api/v1/tasks', () => fail('INTERNAL_ERROR', 'x', 500))],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const todo = await canvas.findByRole('region', { name: '시작 전' }, LOADED)
    await userEvent.click(within(todo).getByRole('button', { name: '시작 전에 직접 추가' }))
    await userEvent.type(within(todo).getByRole('textbox'), '회의실 예약{Enter}')
    await expect(await within(todo).findByRole('alert')).toHaveTextContent(
      '태스크를 추가하지 못했어요.',
    )
    await expect(within(todo).getByRole('textbox')).toHaveValue('회의실 예약')
    await expect(within(todo).queryByRole('link', { name: '회의실 예약' })).toBeNull()
  },
}

/** 캘린더 PM — 마감일 칸에 태스크·확인 필요·회의가 놓이고, 마감 없는 일은 아래에 모인다 */
export const 캘린더_PM: Story = {
  args: { view: calendar },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = await canvas.findByRole('table', { name: '2026년 9월' }, LOADED)
    // 9월은 다섯 주다 — 10월 날만 있는 여섯째 주(10/4~)는 그리지 않는다 (시안)
    await expect(within(table).getAllByRole('cell')).toHaveLength(35)
    await expect(within(table).queryByRole('cell', { name: '2026-10-04' })).toBeNull()
    const day = within(table).getByRole('cell', { name: '2026-09-25' })
    await expect(within(day).getByRole('link', { name: /배포 문서 보완/ })).toHaveAttribute(
      'href',
      `${paths.tasks('ws_01')}?tab=needs_review`,
    )
    await expect(canvas.getByRole('region', { name: '마감일 없음' })).toHaveTextContent(
      '회의록 요약 검수',
    )

    // 시안(TasksCalendar) 값 — 날짜 이동 30×36·15px 꺾쇠 #5A5A5A, `마감일 없음` 13px,
    // 그 달의 일·토 숫자 #666(평일 #5A5A5A), 마감 임박 칩 제목 600
    const prev = canvas.getByRole('button', { name: '이전 달' })
    const prevBox = prev.getBoundingClientRect()
    await expect([prevBox.width, prevBox.height]).toEqual([30, 36])
    await expect(prev.querySelector('svg')!.getAttribute('width')).toBe('15')
    await expect(getComputedStyle(prev).color).toBe('rgb(90, 90, 90)')
    await expect(
      getComputedStyle(canvas.getByRole('heading', { name: '마감일 없음' })).fontSize,
    ).toBe('13px')
    const dayColor = (date: string) =>
      getComputedStyle(within(table).getByRole('cell', { name: date }).firstElementChild!).color
    await expect([dayColor('2026-09-06'), dayColor('2026-09-12'), dayColor('2026-09-07')]).toEqual([
      'rgb(102, 102, 102)',
      'rgb(102, 102, 102)',
      'rgb(90, 90, 90)',
    ])
    const urgent = within(table).getByRole('link', { name: /온보딩 문구 수정/ })
    await expect(getComputedStyle(urgent).backgroundColor).toBe('rgb(255, 105, 105)')
    await expect(getComputedStyle(urgent.firstElementChild!).fontWeight).toBe('600')
  },
}

/** 간트 PM — 팀원별 묶음에 막대가 놓이고, 일정이 없는 일은 아래 목록이다 */
export const 간트_PM: Story = {
  args: { view: gantt },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = await canvas.findByRole('table', { name: '일정' }, LOADED)
    await expect(canvas.getByRole('row', { name: /배포 문서 보완/ })).toBeVisible()
    // 오늘 선이 표 높이만큼 서고 머리의 오늘 날짜 원 가운데를 지난다 — `inset-0`·`top-0` 이 생성되지 않아 주말 음영과
    // 함께 높이 0 으로 접혔던 회귀 (VR-10)
    const todayLine = table.querySelector('[data-gantt-today]')!.getBoundingClientRect()
    const todayMark = within(table).getByText(String(Number(MOCK_TODAY.slice(8, 10))))
    const mark = todayMark.getBoundingClientRect()
    await expect(Math.abs(todayLine.height - table.clientHeight)).toBeLessThanOrEqual(1)
    await expect(
      Math.abs(todayLine.left + todayLine.width / 2 - (mark.left + mark.width / 2)),
    ).toBeLessThanOrEqual(1)
    const unscheduled = canvas.getByRole('region', { name: '일정이 없는 일' })
    await expect(unscheduled).toHaveTextContent('알림 문구 검토')
    // 시안: `미지정` 묶음의 보조 문구는 한 줄이고, `날짜 넣기` 는 12.5px·600·높이 32 에 꺾쇠가 붙는다
    const note = canvas.getByText('승인하면 담당자가 붙습니다')
    await expect(note.getBoundingClientRect().height).toBeLessThanOrEqual(
      parseFloat(getComputedStyle(note).lineHeight) + 1,
    )
    // 확인 필요의 `날짜 넣기` 는 그 승인 상세(보완·승인)로 간다. 읽는 이름에는 일의 제목이 붙는다
    const dateLink = within(unscheduled).getByRole('link', { name: '알림 문구 검토 날짜 넣기' })
    await expect(dateLink).toHaveAttribute('href', paths.approval('ws_01', 'ap_01'))
    const linkStyle = getComputedStyle(dateLink)
    await expect([linkStyle.fontSize, linkStyle.fontWeight, linkStyle.height]).toEqual([
      '12.5px',
      '600',
      '32px',
    ])
    await expect(dateLink.querySelector('svg')).not.toBeNull()

    // 시안(TasksGantt) 값 — 목록 위 14px·간격 10, 제목 14px. 줄은 간격 12·위아래 13·아래선 #EFEFEF,
    // `일정 없음` 21px·11px #5A5A5A, 일 제목 13.5px, 담당자 미지정은 채우지 않은 점선 원
    const listStyle = getComputedStyle(unscheduled)
    await expect([listStyle.paddingTop, listStyle.rowGap]).toEqual(['14px', '10px'])
    await expect(
      getComputedStyle(within(unscheduled).getByRole('heading', { name: /일정이 없는 일/ }))
        .fontSize,
    ).toBe('14px')
    const row = dateLink.closest('li')!
    const rowStyle = getComputedStyle(row)
    await expect([
      rowStyle.columnGap,
      rowStyle.paddingTop,
      rowStyle.paddingBottom,
      rowStyle.borderBottomColor,
    ]).toEqual(['12px', '13px', '13px', 'rgb(239, 239, 239)'])
    const badge = within(row).getByText('일정 없음')
    await expect([
      badge.getBoundingClientRect().height,
      getComputedStyle(badge).fontSize,
      getComputedStyle(badge).color,
    ]).toEqual([21, '11px', 'rgb(90, 90, 90)'])
    await expect(getComputedStyle(within(row).getByText('알림 문구 검토')).fontSize).toBe('13.5px')
    const unknown = getComputedStyle(within(row).getByText('?'))
    await expect([
      unknown.borderTopStyle,
      unknown.borderTopColor,
      unknown.backgroundColor,
      unknown.fontSize,
    ]).toEqual(['dashed', 'rgb(189, 189, 189)', 'rgba(0, 0, 0, 0)', '10px'])
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
    await expect(canvas.queryByRole('table')).toBeNull()
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
    await canvas.findByRole('table', { name: '2026년 9월' }, LOADED)
    await expect(canvas.getByRole('alert')).toHaveTextContent('회의 정보를 불러오지 못했어요')
  },
}

/** 마감이 없는 달 — 격자는 그대로 두고 그렇다고 알린다. 앞 달로 돌아가면 사라진다 */
export const 캘린더_빈_달: Story = {
  args: { view: { ...calendar, month: '2026-10' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('table', { name: '2026년 10월' }, LOADED)
    await expect(canvas.getByText('이 달에는 마감인 일이 없어요.')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: '이전 달' }))
    await canvas.findByRole('table', { name: '2026년 9월' })
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
