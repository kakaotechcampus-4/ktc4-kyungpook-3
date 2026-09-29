import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, userEvent, within } from 'storybook/test'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { settleMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { CreateWorkspaceStep } from './CreateWorkspaceStep'
import { IntegrationStep } from './IntegrationStep'
import { MembersStep } from './MembersStep'
import { WaitingStep } from './WaitingStep'

/* 온보딩 네 화면 (M4 ②·③). 미완료 공간 시나리오(ws_03, Discord 단계)에서 시작한다 */

const hang = async () => {
  await delay('infinite')
}

/** ws_03 을 팀원 연결 단계로 옮기고 두 연동을 붙인다 */
function atMembers() {
  const ws03 = db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_03')
  if (!ws03) return
  ws03.onboarding.steps[1].status = 'completed'
  ws03.onboarding.steps[2].status = 'completed'
  ws03.onboarding.current_step = 'connect_members'
  settleMockOAuth({ workspaceId: 'ws_03', provider: 'discord', outcome: 'success' })
  settleMockOAuth({ workspaceId: 'ws_03', provider: 'notion', outcome: 'success' })
}

const meta = {
  title: 'M4 온보딩/단계',
  component: CreateWorkspaceStep,
  parameters: { scenario: 'incomplete-workspace', route: '/onboarding/create_workspace' },
} satisfies Meta<typeof CreateWorkspaceStep>

export default meta
type Story = StoryObj<typeof meta>

export const 만들기_기본: Story = {}

export const 만들기_입력_오류: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: '만들기' }))
    await expect(await canvas.findByText('팀 이름을 입력해 주세요.')).toBeInTheDocument()
  },
}

export const 만들기_제출_중: Story = {
  parameters: { msw: [http.post('/api/v1/workspaces', hang)] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('팀 이름'), '새 팀')
    await userEvent.click(canvas.getByRole('button', { name: '만들기' }))
    await expect(canvas.getByRole('button', { name: '만들기' })).toBeDisabled()
  },
}

export const Discord_기본: Story = {
  render: () => <IntegrationStep workspaceId="ws_03" provider="discord" />,
  parameters: { route: '/onboarding/ws_03/connect_discord' },
}

/** 연동 상태를 받는 중 — 연결·건너뛰기 버튼이 아직 없다 */
export const Discord_로딩: Story = {
  ...Discord_기본,
  parameters: {
    route: '/onboarding/ws_03/connect_discord',
    msw: [http.get('/api/v1/workspaces/:workspaceId/integrations', hang)],
  },
}

export const Discord_조회_오류: Story = {
  ...Discord_기본,
  parameters: {
    route: '/onboarding/ws_03/connect_discord',
    msw: [
      http.get('/api/v1/workspaces/:workspaceId/integrations', () => fail('FORBIDDEN', 'no', 403)),
    ],
  },
}

/** OAuth 에서 취소하고 돌아왔다 — 단계는 그대로이고 안내가 남는다 */
export const Discord_취소_복귀: Story = {
  ...Discord_기본,
  parameters: { route: '/onboarding/ws_03/connect_discord?oauth=discord&oauth_result=cancelled' },
}

export const Notion_기본: Story = {
  render: () => <IntegrationStep workspaceId="ws_03" provider="notion" />,
  parameters: {
    route: '/onboarding/ws_03/connect_notion',
    setup: () => settleMockOAuth({ workspaceId: 'ws_03', provider: 'discord', outcome: 'success' }),
  },
}

export const 팀원_기본: Story = {
  render: () => <MembersStep workspaceId="ws_03" />,
  parameters: { route: '/onboarding/ws_03/connect_members', setup: atMembers },
}

export const 팀원_로딩: Story = {
  ...팀원_기본,
  parameters: {
    route: '/onboarding/ws_03/connect_members',
    setup: atMembers,
    msw: [http.get('/api/v1/workspaces/:workspaceId/discord/members', hang)],
  },
}

export const 팀원_조회_오류: Story = {
  ...팀원_기본,
  parameters: {
    route: '/onboarding/ws_03/connect_members',
    setup: atMembers,
    msw: [
      http.get('/api/v1/workspaces/:workspaceId/discord/members', () =>
        fail('INTERNAL_ERROR', 'x', 500),
      ),
    ],
  },
}

/** 같은 이름을 두 줄에 쓰면 저장 전에 막는다 (D-027) */
export const 팀원_중복_오류: Story = {
  ...팀원_기본,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(await canvas.findByLabelText('@seoyeon_01의 팀원 이름'), '김서연')
    await userEvent.type(canvas.getByLabelText('@minsu의 팀원 이름'), '김서연')
    await userEvent.click(canvas.getByRole('button', { name: '2명 확인 완료' }))
    await expect(
      (await canvas.findAllByText('같은 팀원 이름을 두 줄에 쓸 수 없어요.')).length,
    ).toBe(2)
  },
}

/** 아무것도 적지 않으면 확인 완료가 비활성이다 */
export const 팀원_비활성: Story = { ...팀원_기본 }

/** 일반 팀원 — 입력도 버튼도 없다 */
export const 대기_일반_팀원: Story = {
  render: () => <WaitingStep step="connect_notion" />,
  parameters: { scenario: 'multiple-workspaces', route: '/onboarding/ws_02/connect_notion' },
}
