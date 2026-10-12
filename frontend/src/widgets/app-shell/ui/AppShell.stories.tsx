import type { Meta, StoryObj } from '@storybook/react-vite'
import { delay, http } from 'msw'
import { expect, userEvent, within } from 'storybook/test'
import { fail } from '@/shared/mock/envelope'
import { AppHeader, AppHeaderSkeleton } from './AppHeader'
import { WorkspaceChoiceList } from './WorkspaceChoiceList'

/* 앱 셸 (M4 ④). 부팅 조회(세션·목록)만 쓴다 */

const meta = {
  title: 'M4 메뉴/앱 셸',
  component: AppHeader,
  args: { workspaceId: 'ws_01' },
  parameters: { route: '/workspaces/ws_01/dashboard' },
} satisfies Meta<typeof AppHeader>

export default meta
type Story = StoryObj<typeof meta>

export const 헤더_기본: Story = {}

/**
 * UX1-M01 — 가드가 세션·소속을 기다리는 동안의 헤더 자리. 진짜 헤더와 같은 76px 상자(아래 선)라 셸이 떠도 아래 화면이 내려가지 않는다.
 * 장식이라 랜드마크가 아니다
 */
export const 헤더_뼈대: Story = {
  render: () => (
    <div className="flex flex-col">
      <AppHeaderSkeleton />
      <AppHeader workspaceId="ws_01" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const skeleton = canvas.getByTestId('app-header-skeleton')
    const header = await canvas.findByRole('banner')
    await expect(skeleton.getBoundingClientRect().height).toBe(76)
    await expect(skeleton.getBoundingClientRect().height).toBe(
      header.getBoundingClientRect().height,
    )
    await expect(skeleton).toHaveAttribute('aria-hidden', 'true')
    await expect(canvas.getAllByRole('banner')).toHaveLength(1)
  },
}

/** M5 U4 — 이 공간에 정리 중 회의가 있으면 회의록 탭 옆에 `정리 중` 링크. 경로는 앱 계층이 넘긴다 */
export const 헤더_정리_중: Story = {
  args: { processingHref: '/workspaces/ws_01/meetings/mt_10/processing' },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('link', { name: '정리 중' }),
    ).toHaveAttribute('href', '/workspaces/ws_01/meetings/mt_10/processing')
  },
}

/** 워크스페이스 메뉴 — 미완료 공간 `설정 미완료`, 지금 공간 체크, 새 공간·설정·목록 */
export const 워크스페이스_메뉴_열림: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole('button', { name: /^워크스페이스 바꾸기/ }),
    )
    await expect(await within(document.body).findByRole('menu')).toBeInTheDocument()
  },
}

export const 계정_메뉴_열림: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: /^내 계정/ }))
    await expect(await within(document.body).findByRole('menu')).toBeInTheDocument()
  },
}

/** 로그아웃 실패 — 아바타 옆에 안내가 남고 화면은 그대로다 */
export const 로그아웃_오류: Story = {
  parameters: {
    msw: [http.post('/api/v1/auth/logout', () => fail('INTERNAL_ERROR', 'x', 500))],
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(await within(canvasElement).findByRole('button', { name: /^내 계정/ }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: '로그아웃' }))
    await expect(await within(canvasElement).findByRole('alert')).toBeInTheDocument()
  },
}

function Choices() {
  return (
    <div className="mx-auto w-[480px] p-24">
      <WorkspaceChoiceList />
    </div>
  )
}

export const 선택_목록_기본: Story = {
  render: () => <Choices />,
  parameters: { route: '/workspaces' },
}

export const 선택_목록_로딩: Story = {
  render: () => <Choices />,
  parameters: {
    route: '/workspaces',
    msw: [
      http.get('/api/v1/workspaces', async () => {
        await delay('infinite')
      }),
    ],
  },
}

export const 선택_목록_오류: Story = {
  render: () => <Choices />,
  parameters: {
    route: '/workspaces',
    msw: [http.get('/api/v1/workspaces', () => fail('FORBIDDEN', 'no', 403))],
  },
}

export const 선택_목록_빈: Story = {
  render: () => <Choices />,
  parameters: { route: '/workspaces', scenario: 'no-workspace' },
}
