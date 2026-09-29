import type { Meta, StoryObj } from '@storybook/react-vite'
import { Panel } from '../panel/Panel'
import { Card } from './Card'

const meta = {
  title: 'M2 공통 UI/Card · Panel',
  component: Card,
  args: { children: '카드 한 겹' },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const 변형: Story = {
  render: (args) => (
    <div className="flex w-[420px] flex-col gap-16">
      <Card {...args} variant="default">
        default
      </Card>
      <Card {...args} variant="attention">
        attention — 지금 봐야 하는 카드
      </Card>
      <Card {...args} variant="pending">
        pending — 아직 정해지지 않음
      </Card>
      <Card {...args} variant="onboarding">
        onboarding
      </Card>
      <Panel>눌린 면 — 근거 블록</Panel>
    </div>
  ),
}
