import type { Meta, StoryObj } from '@storybook/react-vite'
import { OnboardingSkeleton } from './OnboardingSkeleton'

/* 화면 전체 뼈대라 Skeleton 스토리의 420px 틀에 넣지 않는다 — 가운데 512px 열이 실제 자리에 앉는지 본다 */
const meta = {
  title: 'M4 온보딩/OnboardingSkeleton',
  component: OnboardingSkeleton,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof OnboardingSkeleton>

export default meta
type Story = StoryObj<typeof meta>

/** 온보딩 화면이 오는 동안 — 단계 점 · 말풍선 두 줄 · 카드 · `n / 4` 줄 */
export const 기본: Story = {}
