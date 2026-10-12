import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { fail } from '@/shared/mock/envelope'
import { TaskNotionSyncStatus } from './TaskNotionSyncStatus'

/*
 * 태스크의 Notion 반영 상태 (M6 §4-7, §4-8, §5-1). 문구는 서버의 `notion_sync_status` 만 따른다.
 * tk_04 를 시나리오로 고른다 — notion-sync-pending 은 반영 중, notion-sync-failed 는 반영 실패, tasks-default 는 상태 없음.
 * tk_01 은 픽스처부터 synced 다. MSW 에는 synced 로 넘기는 워커가 없어 반영 중 스토리는 반영 중에 머문다.
 */

const meta = {
  title: 'M6 태스크/Notion 상태',
  component: TaskNotionSyncStatus,
  args: { workspaceId: 'ws_01', taskId: 'tk_04', canRetry: true },
  parameters: { scenario: 'tasks-default', route: '/workspaces/ws_01/tasks/tk_04' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-[720px] px-24 py-48">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TaskNotionSyncStatus>

export default meta
type Story = StoryObj<typeof meta>

const status = (canvasElement: HTMLElement) =>
  within(canvasElement).findByTestId('notion-sync-status')

export const 반영됨: Story = {
  args: { taskId: 'tk_01' },
  play: async ({ canvasElement }) => {
    await expect(await status(canvasElement)).toHaveTextContent('반영됨')
  },
}

export const 반영_중: Story = {
  parameters: { scenario: 'notion-sync-pending' },
  play: async ({ canvasElement }) => {
    await expect(await status(canvasElement)).toHaveTextContent('반영 중')
    await expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}

/** 반영 실패 — PM 은 다시 반영을 요청한다. 성공 응답은 다시 대기열에 넣었다는 뜻이라 `반영 중` 이다 */
export const 반영_실패_PM: Story = {
  parameters: { scenario: 'notion-sync-failed' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await status(canvasElement)).toHaveTextContent('반영 실패')
    await userEvent.click(canvas.getByRole('button', { name: '다시 반영하기' }))
    await expect(await canvas.findByText('반영 중')).toBeInTheDocument()
    await expect(
      canvas.getByText('다시 반영을 요청했어요. 반영되면 여기에서 바뀌어요.'),
    ).toBeInTheDocument()
  },
}

/** 일반 팀원(권한) — 반영 실패를 보기만 한다 */
export const 반영_실패_팀원: Story = {
  args: { canRetry: false },
  parameters: { scenario: 'notion-sync-failed' },
  play: async ({ canvasElement }) => {
    await expect(await status(canvasElement)).toHaveTextContent('반영 실패')
    await expect(within(canvasElement).queryByRole('button')).toBeNull()
  },
}

/** 다시 반영 요청이 실패했다 — 오류가 버튼에 연결되고 상태는 그대로다 */
export const 재시도_오류: Story = {
  parameters: {
    scenario: 'notion-sync-failed',
    msw: [
      http.post('/api/v1/tasks/:taskId/notion-sync/retry', () =>
        fail('INTEGRATION_NOT_CONNECTED', 'x', 409, { provider: 'notion' }),
      ),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await status(canvasElement)).toHaveTextContent('반영 실패')
    const retry = canvas.getByRole('button', { name: '다시 반영하기' })
    await userEvent.click(retry)
    await waitFor(() => expect(retry).toHaveAccessibleDescription(/\S/))
    await expect(await status(canvasElement)).toHaveTextContent('반영 실패')
  },
}

export const 상태_없음: Story = {
  play: async ({ canvasElement }) => {
    await expect(await status(canvasElement)).toHaveTextContent('반영 상태 없음')
  },
}

export const 확인_중: Story = {
  parameters: {
    msw: [
      http.get('/api/v1/tasks/:taskId', async () => {
        await delay('infinite')
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('확인하는 중이에요')).toBeInTheDocument()
  },
}
