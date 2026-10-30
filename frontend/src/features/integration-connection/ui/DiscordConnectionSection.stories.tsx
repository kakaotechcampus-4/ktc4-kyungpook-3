import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, within } from 'storybook/test'
import { fail } from '@/shared/mock/envelope'
import { DiscordConnectionSection } from './DiscordConnectionSection'

/*
 * 워크스페이스 설정의 Discord 연결 영역 (M8-B B-1). 온보딩에서 건너뛴 Discord 를 여기서 연결한다 (D-011).
 * 연동 상태는 시나리오로 고른다 — settings-discord-skipped 는 ws_03 미연결, single-workspace 는 ws_01 연결됨,
 * settings-member 는 ws_01 미연결이다. PM 만 연결·재연결 버튼을 보고, 일반 팀원은 상태와 요청 안내만 본다.
 */

const meta = {
  title: 'M8 설정/Discord 영역',
  component: DiscordConnectionSection,
  args: { workspaceId: 'ws_03', canManage: true },
  parameters: { scenario: 'settings-discord-skipped', route: '/workspaces/ws_03/settings' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-[720px] px-24 py-48">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DiscordConnectionSection>

export default meta
type Story = StoryObj<typeof meta>

export const PM_미연결: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('연결 안 됨')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Discord 연결하기' })).toBeInTheDocument()
  },
}

export const PM_연결됨: Story = {
  args: { workspaceId: 'ws_01' },
  parameters: { scenario: 'single-workspace', route: '/workspaces/ws_01/settings' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('연결됨')).toBeInTheDocument()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** 복귀했는데 취소했다 — 안내와 다시 연결 */
export const PM_취소_복귀: Story = {
  parameters: { route: '/workspaces/ws_03/settings?oauth=discord&oauth_result=cancelled' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('Discord 연결을 취소했어요. 연결하려면 다시 시도해 주세요.'),
    ).toBeInTheDocument()
    // 안내는 복귀를 읽자마자 보인다. 버튼은 연동 상태를 받은 뒤다
    await expect(
      await canvas.findByRole('button', { name: 'Discord 연결하기' }),
    ).toBeInTheDocument()
  },
}

/** 팀원 — 연결 버튼 대신 PM 에게 요청하라는 안내 */
export const 팀원_미연결: Story = {
  args: { workspaceId: 'ws_01', canManage: false },
  parameters: { scenario: 'settings-member', route: '/workspaces/ws_01/settings' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('연결 안 됨')).toBeInTheDocument()
    await expect(canvas.getByText(/PM에게 Discord 연결을 요청해 주세요/)).toBeInTheDocument()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

export const 팀원_연결됨: Story = {
  args: { workspaceId: 'ws_01', canManage: false },
  parameters: { scenario: 'single-workspace', route: '/workspaces/ws_01/settings' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Discord 연결은 PM이 관리해요.')).toBeInTheDocument()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** 상태를 아직 받지 못했다 */
export const 로딩: Story = {
  parameters: {
    msw: [
      http.get('/api/v1/workspaces/:workspaceId/integrations', async () => {
        await delay('infinite')
      }),
    ],
  },
}

/** 조회 실패는 미연결로 보지 않는다 — 다시 시도 */
export const 조회_오류: Story = {
  parameters: {
    msw: [
      http.get('/api/v1/workspaces/:workspaceId/integrations', () =>
        fail('INVALID_REQUEST', 'x', 400),
      ),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    await expect(canvas.queryByText('연결 안 됨')).toBeNull()
  },
}
