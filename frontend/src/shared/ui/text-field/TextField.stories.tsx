import type { Meta, StoryObj } from '@storybook/react-vite'
import { TextField } from './TextField'

const meta = {
  title: 'M2 공통 UI/TextField',
  component: TextField,
  args: { label: '이메일', placeholder: 'name@example.com', tone: 'auth' },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[384px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TextField>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

export const 화면군: Story = {
  render: (args) => (
    <div className="flex flex-col gap-16">
      <TextField {...args} tone="product" label="제품" />
      <TextField {...args} tone="onboarding" label="온보딩" />
      <TextField {...args} tone="auth" label="인증" />
    </div>
  ),
}

export const 설명: Story = { args: { label: '비밀번호', description: '8자 이상, 숫자 포함' } }

/** 입력 아래 오류 — aria-invalid · aria-describedby 로 이어진다 (D-142) */
export const 오류: Story = {
  args: { defaultValue: 'pm', error: '이메일 형식으로 입력해 주세요.' },
}

export const 비활성: Story = { args: { disabled: true, defaultValue: 'pm@example.com' } }

export const 읽기_전용: Story = { args: { readOnly: true, defaultValue: '카테캠 3팀' } }
