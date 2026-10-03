import type { Meta, StoryObj } from '@storybook/react-vite'
import { Mascot } from './Mascot'

const POSES = ['idle', 'left', 'right', 'squint', 'upLeft', 'upRight', 'talking', 'dial'] as const

const meta = {
  title: 'M2 공통 UI/Mascot',
  component: Mascot,
  args: { pose: 'idle', size: 148, label: '매스' },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Mascot>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

export const 포즈: Story = {
  render: (args) => (
    <div className="grid grid-cols-4 gap-24">
      {POSES.map((pose) => (
        <Mascot key={pose} {...args} pose={pose} size={96} label={pose} />
      ))}
    </div>
  ),
}
