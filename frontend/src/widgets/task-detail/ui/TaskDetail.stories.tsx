import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, within } from 'storybook/test'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { TaskDetail } from './TaskDetail'

/*
 * 태스크 상세 (M6 §3-5, §5-1). ws_01 하나에 로그인한 상태. tk_01 은 담당자·마감·진행률·연결 회의·이력이 있고 Notion 반영됨이다.
 * PM 만 상태를 바꾼다 — 팀원 스토리는 widget 의 `isPm` 과 시나리오(tasks-member) 둘 다 팀원이다.
 */

const meta = {
  title: 'M6 태스크/상세',
  component: TaskDetail,
  args: { workspaceId: 'ws_01', taskId: 'tk_01', isPm: true },
  parameters: { scenario: 'tasks-default', route: '/workspaces/ws_01/tasks/tk_01' },
} satisfies Meta<typeof TaskDetail>

export default meta
type Story = StoryObj<typeof meta>

/** PM — 모든 칸과 이력, 상태 바꾸기 */
export const PM_기본: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: '로그인 API 연동' })).toBeVisible()
    await expect(canvas.getByLabelText('상태 바꾸기')).toHaveValue('in_progress')
    await expect(canvas.getByText('40%')).toBeInTheDocument()
    await expect(await canvas.findByTestId('notion-sync-status')).toHaveTextContent('반영됨')
    await expect(await canvas.findByRole('list', { name: '변경 이력' })).toBeInTheDocument()
  },
}

/** 일반 팀원(권한) — 읽기만 한다. 상태 바꾸기·Notion 다시 반영이 없다 */
export const 팀원_읽기: Story = {
  args: { isPm: false },
  parameters: { scenario: 'tasks-member' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: '로그인 API 연동' })).toBeVisible()
    await expect(canvas.getByTestId('task-status')).toHaveTextContent('진행 중')
    await expect(canvas.queryByLabelText('상태 바꾸기')).toBeNull()
  },
}

/** 담당자·마감·진행률·연결 회의·이력이 없는 기존 태스크도 읽는다 */
export const 빈_칸: Story = {
  args: { taskId: 'tk_07' },
  parameters: {
    route: '/workspaces/ws_01/tasks/tk_07',
    setup: () => {
      db.taskHistory = db.taskHistory.filter(({ task_id }) => task_id !== 'tk_07')
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: '온보딩 문구 수정' })).toBeVisible()
    await expect(canvas.getByText('담당자 없음')).toBeInTheDocument()
    await expect(canvas.getByText('기록 없음')).toBeInTheDocument()
    await expect(await canvas.findByTestId('notion-sync-status')).toHaveTextContent(
      '반영 상태 없음',
    )
    await expect(await canvas.findByText('아직 변경 이력이 없어요.')).toBeInTheDocument()
  },
}

export const 로딩: Story = {
  parameters: {
    msw: [
      http.get('/api/v1/tasks/:taskId', async () => {
        await delay('infinite')
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('link', { name: '← 태스크 목록' })).toBeInTheDocument()
    await expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull()
    await expect(canvas.queryByRole('heading', { level: 2 })).toBeNull()
  },
}

/** 조회 실패 — 다시 시도. 400 은 다시 묻지 않아 바로 오류가 보인다 */
export const 오류: Story = {
  parameters: {
    msw: [http.get('/api/v1/tasks/:taskId', () => fail('INVALID_REQUEST', 'x', 400))],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('태스크를 불러오지 못했어요')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  },
}

/** 없는 태스크 — 다시 시도해도 같아서 목록으로 돌려보낸다 */
export const 볼_수_없음: Story = {
  args: { taskId: 'tk_99' },
  parameters: { route: '/workspaces/ws_01/tasks/tk_99' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('이 태스크를 볼 수 없어요')).toBeInTheDocument()
    await expect(canvas.getByRole('link', { name: '태스크 목록으로' })).toHaveAttribute(
      'href',
      '/workspaces/ws_01/tasks',
    )
  },
}
