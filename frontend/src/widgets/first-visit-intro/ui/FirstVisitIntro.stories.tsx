import type { Meta, StoryObj } from '@storybook/react-vite'
import { FirstVisitIntro } from './FirstVisitIntro'

const meta = {
  title: '#430 첫 방문 인트로/인트로',
  component: FirstVisitIntro,
  args: { open: true, onClose: () => undefined },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof FirstVisitIntro>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

export const 휴대폰: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
}
