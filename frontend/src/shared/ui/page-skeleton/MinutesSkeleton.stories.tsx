import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { MinutesDetailSkeleton, MinutesPageSkeleton } from './MinutesSkeleton'

/* 화면 전체 뼈대라 Skeleton 스토리의 420px 틀에 넣지 않는다 — 앱 셸처럼 세로로 늘어나는 칸에 넣어 왼쪽 308px 목록과
   오른쪽 본문이 실제 자리에 앉는지 본다 */
const meta = {
  title: 'M5 회의/회의록 스켈레톤',
  component: MinutesPageSkeleton,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="flex min-h-dvh flex-col bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MinutesPageSkeleton>

export default meta
type Story = StoryObj<typeof meta>

/** 회의록 화면 코드가 오는 동안(라우트 스켈레톤) — 왼쪽 목록 머리·행 세 줄, 오른쪽 제목·메타·참석자·탭 줄·본문 */
export const 화면: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const main = canvas.getByRole('main')
    await expect(main).toHaveAttribute('aria-busy', 'true')
    const aside = canvas.getByTestId('minutes-skeleton-aside')
    await expect(aside.getBoundingClientRect().width).toBe(308)
    await expect(canvas.getByTestId('minutes-list-skeleton')).toBeInTheDocument()
    const tabs = canvas.getByTestId('minutes-detail-skeleton-tabs')
    // 본문은 목록 오른쪽 같은 줄에 있다
    await expect(tabs.getBoundingClientRect().left).toBeGreaterThanOrEqual(308)
  },
}

/** 고른 회의의 회의록이 오는 동안(느린 응답) — 실제 본문과 같은 배치 */
export const 본문: Story = {
  render: () => <MinutesDetailSkeleton />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('minutes-detail-skeleton')).toHaveAttribute('aria-busy', 'true')
    await expect(canvas.getByTestId('minutes-detail-skeleton-title')).toBeInTheDocument()
    await expect(canvas.getByTestId('minutes-detail-skeleton-tabs')).toBeInTheDocument()
  },
}
