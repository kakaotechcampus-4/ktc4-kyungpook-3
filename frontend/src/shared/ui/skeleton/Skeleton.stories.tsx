import type { Meta, StoryObj } from '@storybook/react-vite'
import { PageSkeleton } from '../page-skeleton/PageSkeleton'
import { Skeleton } from './Skeleton'

const meta = {
  title: 'M2 공통 UI/Skeleton',
  component: Skeleton,
  args: { lines: 3 },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

/** 조회 대기 — 로딩 상태의 공통 모양 */
export const 로딩_글줄: Story = {}

export const 로딩_블록: Story = { args: { variant: 'block', height: 120, lines: undefined } }

export const 로딩_원: Story = {
  args: { variant: 'circle', width: 40, height: 40, lines: undefined },
}

/** 지연 로드 화면의 자리 (D-130) */
export const 페이지: Story = {
  render: () => <PageSkeleton />,
  parameters: { layout: 'fullscreen' },
}
