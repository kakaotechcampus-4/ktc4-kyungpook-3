import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, within } from 'storybook/test'
import { fail } from '@/shared/mock/envelope'
import { NotionConnectionSection } from './NotionConnectionSection'

/*
 * 워크스페이스 설정의 Notion 연결 영역 (M5 U3, 계획 §1 — M8 설정에서 이 영역만 앞당겼다).
 * 연동 상태는 시나리오로 고른다 — single-workspace 는 연결됨, meeting-notion-* 는 미연결·끊김이다.
 * PM 만 연결·재연결 버튼을 보고, 일반 팀원은 상태와 「PM에게 연결 요청」 안내만 본다 (U3-3). 역할은 설정 화면이 `canManage` 로 넘긴다.
 */

const meta = {
  title: 'M5 회의/설정 Notion 영역',
  component: NotionConnectionSection,
  args: { workspaceId: 'ws_01', canManage: true },
  parameters: { scenario: 'meeting-notion-not-connected', route: '/workspaces/ws_01/settings' },
  decorators: [
    (Story) => (
      <div className="mx-auto w-full max-w-[720px] px-24 py-48">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NotionConnectionSection>

export default meta
type Story = StoryObj<typeof meta>

export const PM_미연결: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('연결 안 됨')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Notion 연결하기' })).toBeInTheDocument()
  },
}

export const PM_끊김: Story = {
  parameters: { scenario: 'meeting-notion-revoked' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('연결 끊김')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: 'Notion 다시 연결하기' })).toBeInTheDocument()
  },
}

export const PM_연결됨: Story = {
  parameters: { scenario: 'single-workspace' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('연결됨')).toBeInTheDocument()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

/** 차단 모달에서 왔다 — 제목이 포커스를 받아 이 영역부터 읽는다 */
export const PM_차단_모달에서_옴: Story = {
  parameters: {
    route:
      '/workspaces/ws_01/settings?section=notion&next=%2Fworkspaces%2Fws_01%2Fmeetings%2Fupload',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { name: 'Notion 연결' })).toHaveFocus()
  },
}

/** 팀원 — 연결 버튼 대신 PM 에게 요청하라는 안내 */
export const 팀원_미연결: Story = {
  args: { canManage: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('연결 안 됨')).toBeInTheDocument()
    await expect(canvas.getByText(/PM에게 Notion 연결을 요청해 주세요/)).toBeInTheDocument()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
}

export const 팀원_연결됨: Story = {
  args: { canManage: false },
  parameters: { scenario: 'single-workspace' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Notion 연결은 PM이 관리해요.')).toBeInTheDocument()
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
