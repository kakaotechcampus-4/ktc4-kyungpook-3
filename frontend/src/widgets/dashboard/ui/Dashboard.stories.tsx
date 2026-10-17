import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { paths } from '@/shared/config/routes'
import { fail } from '@/shared/mock/envelope'
import { MOCK_TODAY } from '@/shared/mock/fixtures/constants'
import { Dashboard } from './Dashboard'

/*
 * 대시보드 (M7, Main 시안). ws_01 하나에 로그인한 상태 — 태스크 10건, 대기 승인 3건, 최신 완료 회의 mt_09 의 auto 항목 3개.
 * 오늘은 픽스처의 서울 오늘(2026-09-18)로 고정한다. 역할은 widget 의 `isPm` 과 시나리오(dashboard-member) 둘 다 맞춘다.
 * 상태별 시작 db 는 shared/mock/scenarios.ts 의 `dashboard-*` 시나리오다
 */

const meta = {
  title: 'M7 대시보드/화면',
  component: Dashboard,
  args: {
    workspaceId: 'ws_01',
    isPm: true,
    today: MOCK_TODAY,
    needsReviewHref: `${paths.tasks('ws_01')}?tab=needs_review`,
    dueSoonHref: `${paths.tasks('ws_01')}?tab=in_progress&due=overdue,soon`,
  },
  parameters: { scenario: 'dashboard-default', route: '/workspaces/ws_01/dashboard' },
} satisfies Meta<typeof Dashboard>

export default meta
type Story = StoryObj<typeof meta>

const recentRows = (canvasElement: HTMLElement) =>
  within(canvasElement).findAllByTestId('recent-row')

/** PM — 요약 넷, 확인 필요 3, 마감 임박 5(전체 보기), 최근 반영 3(모두 반영 완료) */
export const PM_기본: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('확인이 필요한 일이 있어요')).toBeInTheDocument()
    const review = await canvas.findByRole('list', { name: '확인이 필요한 일 목록' })
    await expect(within(review).getAllByRole('link')).toHaveLength(3)
    const due = await canvas.findByRole('list', { name: '마감 임박 목록' })
    await expect(within(due).getAllByRole('link')).toHaveLength(5)
    await expect(canvas.getByRole('link', { name: '전체 보기' })).toBeInTheDocument()
    const rows = await recentRows(canvasElement)
    await expect(rows.map((row) => row.textContent?.includes('반영 완료'))).toEqual([
      true,
      true,
      true,
    ])
    await expect(canvas.getByRole('button', { name: '전체 로그' })).toBeDisabled()
  },
}

/** 일반 팀원(권한) — 확인 대기·확인 필요·되돌리기가 없다 */
export const 팀원: Story = {
  args: { isPm: false },
  parameters: { scenario: 'dashboard-member' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('워크스페이스 현황')).toBeInTheDocument()
    await recentRows(canvasElement)
    await expect(canvas.queryByText('확인 대기')).toBeNull()
    await expect(canvas.queryByRole('heading', { name: '확인이 필요한 일' })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /되돌리기$/ })).toBeNull()
  },
}

/** 조회가 늦다 — 영역마다 스켈레톤, 숫자는 0 으로 쓰지 않는다 */
export const 로딩: Story = {
  parameters: {
    msw: [
      http.get('/api/v1/tasks', async () => {
        await delay('infinite')
      }),
      http.get('/api/v1/approvals', async () => {
        await delay('infinite')
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect((await canvas.findAllByText('불러오는 중')).length).toBeGreaterThan(0)
    await expect(canvas.getByText('워크스페이스 현황')).toBeInTheDocument()
  },
}

/** 빈 상태 ① 정리한 회의가 없다 → 회의 업로드 */
export const 빈_상태_회의_없음: Story = {
  parameters: { scenario: 'dashboard-no-meeting' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('link', { name: '회의 업로드' })).toHaveAttribute(
      'href',
      paths.meetingUpload('ws_01'),
    )
  },
}

/** 빈 상태 ② Notion 미연결 → Notion 설정 */
export const 빈_상태_Notion_미연결: Story = {
  parameters: { scenario: 'dashboard-notion-not-connected' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Notion이 연결되지 않았어요')).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: 'Notion 설정' })).toHaveAttribute(
      'href',
      paths.settingsNotion('ws_01'),
    )
  },
}

/** 빈 상태 ③ 최근 회의에 자동 처리 항목이 없다 → 최근 회의록 */
export const 빈_상태_자동_처리_없음: Story = {
  parameters: { scenario: 'dashboard-no-auto' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('link', { name: '최근 회의록' })).toHaveAttribute(
      'href',
      paths.meetings('ws_01', 'mt_07'),
    )
  },
}

/** 반영 대기 — 3초마다 태스크 목록을 다시 받는다 */
export const 반영_대기: Story = {
  parameters: { scenario: 'dashboard-sync-pending' },
  play: async ({ canvasElement }) => {
    const rows = await recentRows(canvasElement)
    await waitFor(() => expect(rows[1]).toHaveTextContent('반영 대기'))
  },
}

/** 반영 실패 */
export const 반영_실패: Story = {
  parameters: { scenario: 'dashboard-sync-failed' },
  play: async ({ canvasElement }) => {
    const rows = await recentRows(canvasElement)
    await waitFor(() => expect(rows[1]).toHaveTextContent('반영 실패'))
  },
}

/** 되돌리기 — 확인 모달에서 확인하면 행은 자리를 지키고 `되돌림` 과 새 확인 필요 링크를 보인다 */
export const 되돌리기_성공: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await recentRows(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: 'DB 스키마 정리 되돌리기' }))
    const page = within(canvasElement.ownerDocument.body)
    const dialog = await page.findByRole('dialog', { name: '자동 반영을 되돌릴까요?' })
    await userEvent.click(within(dialog).getByRole('button', { name: '되돌리기' }))
    await waitFor(() =>
      expect(page.queryByRole('dialog', { name: '자동 반영을 되돌릴까요?' })).toBeNull(),
    )
    const rows = await recentRows(canvasElement)
    await waitFor(() => expect(rows[2]).toHaveTextContent('되돌림'))
    await expect(within(rows[2]).getByRole('link', { name: /^확인 필요 보기/ })).toBeInTheDocument()
  },
}

/** 되돌리기 거절 — 만든 뒤 바뀐 태스크(task_changed)는 사유와 태스크 링크를 보인다 */
export const 되돌리기_거절: Story = {
  parameters: { scenario: 'dashboard-revert-rejected' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await recentRows(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: '로그인 API 연동 되돌리기' }))
    const page = within(canvasElement.ownerDocument.body)
    const dialog = await page.findByRole('dialog', { name: '자동 반영을 되돌릴까요?' })
    await userEvent.click(within(dialog).getByRole('button', { name: '되돌리기' }))
    const alert = await canvas.findByRole('alert')
    await expect(alert).toHaveTextContent('만든 뒤에 태스크가 바뀌어 되돌릴 수 없어요.')
    await expect(within(alert).getByRole('link', { name: '태스크 보기' })).toBeInTheDocument()
  },
}

/** 부분 오류 — 최근 반영의 추출만 404. 나머지 영역은 그대로다 */
export const 부분_오류: Story = {
  parameters: { scenario: 'dashboard-partial-error' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('최근 반영을 불러오지 못했어요', {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    await expect(await canvas.findByRole('list', { name: '마감 임박 목록' })).toBeInTheDocument()
  },
}

/** 태스크 조회 오류 — 요약 셋은 `–`, 마감 임박은 오류와 다시 시도. 확인 필요는 그대로다 */
export const 태스크_조회_오류: Story = {
  parameters: {
    msw: [http.get('/api/v1/tasks', () => fail('INTERNAL_ERROR', 'boom', 500))],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('태스크를 불러오지 못했어요', {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    await expect(canvas.getAllByText('불러오지 못했어요')).toHaveLength(3)
    await expect(
      await canvas.findByRole('list', { name: '확인이 필요한 일 목록' }),
    ).toBeInTheDocument()
  },
}
