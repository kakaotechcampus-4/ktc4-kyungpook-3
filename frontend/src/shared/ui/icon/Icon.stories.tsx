import type { Meta, StoryObj } from '@storybook/react-vite'
import { BrandMark } from '../brand-mark/BrandMark'
import { Icon } from './Icon'
import type { IconName } from './Icon'

const NAMES: IconName[] = [
  'chevron-down',
  'chevron-right',
  'check',
  'plus',
  'settings',
  'arrow-right',
  'arrow-left',
  'eye',
  'eye-off',
  'globe',
  'search',
  'play',
  'external',
  'logout',
]

const meta = {
  title: 'M4 공통/Icon · BrandMark',
  component: Icon,
  args: { name: 'check', size: 24 },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Icon>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

export const 전체: Story = {
  render: (args) => (
    <div className="grid grid-cols-7 gap-24 text-sub">
      {NAMES.map((name) => (
        <span key={name} className="flex flex-col items-center gap-6 text-meta">
          <Icon {...args} name={name} />
          {name}
        </span>
      ))}
      <span className="flex flex-col items-center gap-6 text-meta">
        <BrandMark size="lg" />
        brand
      </span>
    </div>
  ),
}
