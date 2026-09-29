import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, userEvent, within } from 'storybook/test'
import { db } from '@/shared/mock/db'
import { fail } from '@/shared/mock/envelope'
import { settleMockOAuth } from '@/shared/mock/oauth/mockOAuth'
import { CreateWorkspaceStep, ResumeCreateStep } from './CreateWorkspaceStep'
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

/** ws_03 을 Notion 단계로 옮긴다. Discord 는 연결했거나 건너뛰었다 — 건너뛰어도 팀원 연결은 pending 이다 (D-073 개정) */
function atNotion(discord: 'completed' | 'skipped') {
  const ws03 = db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_03')
  if (!ws03) return
  ws03.onboarding.steps[1].status = discord
  ws03.onboarding.current_step = 'connect_notion'
  if (discord === 'completed')
    settleMockOAuth({ workspaceId: 'ws_03', provider: 'discord', outcome: 'success' })
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

/** 공간은 만들었는데 단계 저장이 실패했다 — 이름 칸이 잠기고 `다시 시도` 는 단계 저장만 한다 */
export const 만들기_비활성: Story = {
  parameters: {
    msw: [
      http.patch('/api/v1/workspaces/:workspaceId/onboarding', () =>
        fail('INTERNAL_ERROR', 'x', 500),
      ),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText('팀 이름'), '새 팀')
    await userEvent.click(canvas.getByRole('button', { name: '만들기' }))
    await expect(await canvas.findByRole('button', { name: '다시 시도' })).toBeVisible()
    await expect(canvas.getByLabelText('팀 이름')).toHaveAttribute('readonly')
  },
}

/** 지난 1단계 둘러보기 — 저장된 이름만 읽고 카드 `다음`·오른쪽 화살표로 요청 없이 돌아간다 (2026-09-29) */
export const 만들기_둘러보기: Story = {
  render: () => (
    <ResumeCreateStep
      review
      workspace={{
        id: 'ws_03',
        name: '설정 중인 팀',
        role: 'pm',
        createdAt: '2026-09-03T00:00:00Z',
        onboarding: { completed: false, currentStep: 'connect_discord', steps: [] },
      }}
    />
  ),
  parameters: { route: '/onboarding/ws_03/create_workspace?review=1' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByLabelText('팀 이름')).toHaveAttribute('readonly')
    await expect(canvas.queryByRole('button', { name: '만들기' })).toBeNull()
    await expect(canvas.getByRole('button', { name: '다음' })).toBeEnabled()
    await expect(await canvas.findByRole('button', { name: '다음 단계' })).toBeEnabled()
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

/** 연결한 Discord 둘러보기 — `연결됨` 과 요청 없이 옮기는 카드 `다음` */
export const Discord_둘러보기_연결됨: Story = {
  render: () => <IntegrationStep workspaceId="ws_03" provider="discord" review />,
  parameters: {
    route: '/onboarding/ws_03/connect_discord?review=1',
    setup: () => atNotion('completed'),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('연결됨')).toBeVisible()
    await expect(await canvas.findByRole('button', { name: '이전 단계' })).toBeEnabled()
    await expect(canvas.getByRole('button', { name: '다음' })).toBeEnabled()
  },
}

/** 건너뛴 Discord 둘러보기 — `연결하기`·`건너뛰기`. 연결하면 이 둘러보기로 돌아오고, `건너뛰기` 는 요청 없이 옮기기만 한다 */
export const Discord_둘러보기_건너뜀: Story = {
  render: () => <IntegrationStep workspaceId="ws_03" provider="discord" review />,
  parameters: {
    route: '/onboarding/ws_03/connect_discord?review=1',
    setup: () => atNotion('skipped'),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('button', { name: '연결하기' })).toBeEnabled()
    await expect(canvas.getByRole('button', { name: '건너뛰기' })).toBeEnabled()
  },
}

export const Notion_기본: Story = {
  render: () => <IntegrationStep workspaceId="ws_03" provider="notion" />,
  parameters: {
    route: '/onboarding/ws_03/connect_notion',
    setup: () => settleMockOAuth({ workspaceId: 'ws_03', provider: 'discord', outcome: 'success' }),
  },
}

/** 연동 상태를 받는 중 — 연결·건너뛰기 버튼이 아직 없다 */
export const Notion_로딩: Story = {
  ...Notion_기본,
  parameters: {
    ...Notion_기본.parameters,
    msw: [http.get('/api/v1/workspaces/:workspaceId/integrations', hang)],
  },
}

export const Notion_조회_오류: Story = {
  ...Notion_기본,
  parameters: {
    ...Notion_기본.parameters,
    msw: [
      http.get('/api/v1/workspaces/:workspaceId/integrations', () => fail('FORBIDDEN', 'no', 403)),
    ],
  },
}

/** OAuth 에서 취소하고 돌아왔다 — 단계는 그대로이고 안내가 남는다 */
export const Notion_취소_복귀: Story = {
  ...Notion_기본,
  parameters: {
    ...Notion_기본.parameters,
    route: '/onboarding/ws_03/connect_notion?oauth=notion&oauth_result=cancelled',
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

/** Discord 를 건너뛰고 온 팀원 연결 — 불러올 사용자가 없어 안내와 `건너뛰기` 만 있다 (D-073 개정) */
export const 팀원_Discord_없음: Story = {
  render: () => <MembersStep workspaceId="ws_03" />,
  parameters: {
    route: '/onboarding/ws_03/connect_members',
    setup: () => {
      const ws03 = db.workspaces.find(({ workspace_id }) => workspace_id === 'ws_03')
      if (!ws03) return
      ws03.onboarding.steps[1].status = 'skipped'
      ws03.onboarding.steps[2].status = 'completed'
      ws03.onboarding.current_step = 'connect_members'
      settleMockOAuth({ workspaceId: 'ws_03', provider: 'notion', outcome: 'success' })
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('button', { name: '건너뛰기' })).toBeEnabled()
    await expect(canvas.queryByRole('button', { name: '다시 시도' })).toBeNull()
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
