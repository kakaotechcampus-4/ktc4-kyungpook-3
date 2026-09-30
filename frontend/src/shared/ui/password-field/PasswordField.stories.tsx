import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { PasswordField } from './PasswordField'

const meta = {
  title: 'M4 폼/PasswordField',
  component: PasswordField,
  args: {
    tone: 'auth',
    label: '비밀번호',
    showLabel: '비밀번호 보기',
    hideLabel: '비밀번호 숨기기',
    defaultValue: 'secret123',
  },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[384px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PasswordField>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

export const 보기: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: '비밀번호 보기' }))
    await expect(canvas.getByLabelText('비밀번호')).toHaveAttribute('type', 'text')
  },
}

export const 오류: Story = { args: { error: '비밀번호는 8자 이상이고 숫자를 포함해야 해요.' } }

export const 비활성: Story = { args: { disabled: true } }
