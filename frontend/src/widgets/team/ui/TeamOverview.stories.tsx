import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, fn, within } from 'storybook/test'
import { fail } from '@/shared/mock/envelope'
import { MOCK_TODAY } from '@/shared/mock/fixtures/constants'
import { TeamOverview } from './TeamOverview'

/*
 * 팀 화면 (M8-B, Team 캔버스). 오늘은 픽스처의 서울 오늘(2026-09-18)로 고정한다 — 상태 배지·먼저 챙길 것·앞으로 7일이 캔버스처럼 찬다.
 * settings-unmapped 는 ws_01 Discord 연결됨(jihun_dev 미연결, 정하늘은 서버를 떠남), settings-discord-skipped 는 ws_03 Discord 미연결,
 * settings-member 는 ws_01 의 일반 팀원이다. 팀원 연결 창은 주소가 쥐어 여기서는 `connectOpen` 으로 연다
 */

const meta = {
  title: 'M8 팀/화면',
  component: TeamOverview,
  args: {
    workspaceId: 'ws_01',
    isPm: true,
    today: MOCK_TODAY,
    connectOpen: false,
    onConnectOpenChange: fn(),
  },
  parameters: { scenario: 'settings-unmapped', route: '/workspaces/ws_01/members' },
} satisfies Meta<typeof TeamOverview>

export default meta
type Story = StoryObj<typeof meta>

/** PM — 팀원 넷과 맡은 일, 먼저 챙길 것, 연결되지 않은 계정(jihun_dev), 앞으로 7일 */
export const PM_기본: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('region', { name: '김서연' })).toBeInTheDocument()
    await expect(canvas.getByRole('heading', { level: 1 })).toHaveTextContent(/^팀$/)
    await expect(await canvas.findByRole('region', { name: '먼저 챙길 것' })).toBeInTheDocument()
    const unlinked = within(canvas.getByRole('region', { name: '연결되지 않은 계정' }))
    await expect(await unlinked.findByText('jihun_dev')).toBeInTheDocument()
    await expect(canvas.getByRole('button', { name: '팀원 관리' })).toBeInTheDocument()
    await expect(canvas.getByText('오늘')).toBeInTheDocument()
  },
}

/** 일반 팀원 — `팀원 관리`·`연결` 이 없다 */
export const 팀원: Story = {
  args: { isPm: false },
  parameters: { scenario: 'settings-member' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('region', { name: '김서연' })).toBeInTheDocument()
    await expect(canvas.queryByRole('button', { name: '팀원 관리' })).toBeNull()
    const unlinked = within(canvas.getByRole('region', { name: '연결되지 않은 계정' }))
    await expect(
      await unlinked.findByText('Discord를 연결하지 않아 서버의 계정을 불러올 수 없어요.'),
    ).toBeInTheDocument()
    await expect(unlinked.queryByRole('link')).toBeNull()
  },
}

/** Discord 를 건너뛴 공간 — 연결되지 않은 계정 대신 설정으로 가는 안내 */
export const Discord_미연결: Story = {
  args: { workspaceId: 'ws_03' },
  parameters: { scenario: 'settings-discord-skipped', route: '/workspaces/ws_03/members' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const unlinked = within(await canvas.findByRole('region', { name: '연결되지 않은 계정' }))
    await expect(
      await unlinked.findByRole('link', { name: '설정에서 Discord 연결하기' }),
    ).toBeInTheDocument()
  },
}

/** 팀원 연결 창 — 이미 이은 계정은 이름이 채워져 있다 (D-074·D-075) */
export const 팀원_연결_창: Story = {
  args: { connectOpen: true },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const dialog = within(await body.findByRole('dialog', { name: '팀원 연결' }))
    await expect(await dialog.findByLabelText('@minsu의 팀원 이름')).toHaveValue('박민수')
    await expect(dialog.getByLabelText('@jihun_dev의 팀원 이름')).toHaveValue('')
    await expect(dialog.getByRole('button', { name: '나중에 하기' })).toBeInTheDocument()
  },
}

/** 팀원을 아직 받지 못했다 */
export const 로딩: Story = {
  parameters: {
    msw: [http.get('/api/v1/members', () => delay('infinite'))],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('heading', { level: 1 })).toHaveTextContent('팀')
    await expect(canvasElement.querySelector('[aria-busy="true"]')).not.toBeNull()
  },
}

/** 팀원 조회 실패 — 인라인 안내와 다시 시도. 연결되지 않은 계정 영역은 그리지 않는다 */
export const 오류: Story = {
  parameters: {
    msw: [
      http.get('/api/v1/members', () => fail('FORBIDDEN', 'Forbidden: member check failed', 403)),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    await expect(canvas.queryByRole('region', { name: '연결되지 않은 계정' })).toBeNull()
  },
}
