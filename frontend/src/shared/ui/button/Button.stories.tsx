import type { Meta, StoryObj } from '@storybook/react-vite'
import { Icon } from '../icon/Icon'
import { Button } from './Button'

const meta = {
  title: 'M2 공통 UI/Button',
  component: Button,
  args: { children: '저장하기', variant: 'primary', size: 'md' },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

export const 변형: Story = {
  render: (args) => (
    <div className="flex items-center gap-8">
      <Button {...args} variant="primary">
        주 액션
      </Button>
      <Button {...args} variant="default">
        기본
      </Button>
      <Button {...args} variant="outline">
        아웃라인
      </Button>
      <Button {...args} variant="ghost">
        고스트
      </Button>
      <Button {...args} variant="text">
        텍스트
      </Button>
    </div>
  ),
}

export const 로딩: Story = { args: { loading: true } }

export const 비활성: Story = { args: { disabled: true } }

/** 포커스는 남기고 동작만 막는다 — 랜딩의 `문의하기` */
export const 포커스를_남기는_비활성: Story = {
  args: { 'aria-disabled': true, children: '문의하기', variant: 'outline' },
}

export const 아이콘: Story = {
  args: { variant: 'outline', size: 'auth', startIcon: <Icon name="globe" size={18} /> },
  render: (args) => (
    <div className="w-[384px]">
      <Button {...args}>Google 계정으로 로그인</Button>
    </div>
  ),
}
