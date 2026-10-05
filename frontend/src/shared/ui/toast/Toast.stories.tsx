import type { Meta, StoryObj } from '@storybook/react-vite'
import { Toast, ToastProvider, ToastViewport } from './Toast'

const meta = {
  title: 'M2 공통 UI/Toast',
  component: Toast,
  args: { open: true, title: '반영했어요', duration: 1_000_000 },
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
        <ToastViewport />
      </ToastProvider>
    ),
  ],
} satisfies Meta<typeof Toast>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

export const 되돌리기: Story = {
  args: {
    title: 'Notion 에 반영했어요',
    description: 'API 명세서',
    action: { label: '되돌리기', onClick: () => undefined },
  },
}
