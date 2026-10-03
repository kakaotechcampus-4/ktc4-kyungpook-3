import type { Meta, StoryObj } from '@storybook/react-vite'
import { Checkbox } from './Checkbox'

const meta = {
  title: 'M2 공통 UI/Checkbox',
  component: Checkbox,
  args: { children: '담당자에게 DM 보내기' },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

export const 선택됨: Story = { args: { defaultChecked: true } }

export const 일부: Story = { args: { checked: 'indeterminate' } }

export const 오류: Story = { args: { invalid: true } }

export const 비활성: Story = { args: { disabled: true, defaultChecked: true } }
