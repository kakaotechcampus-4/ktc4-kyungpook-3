import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../button/Button'
import { Modal } from './Modal'

const meta = {
  title: 'M2 공통 UI/Modal',
  component: Modal,
  args: {
    open: true,
    onOpenChange: () => undefined,
    title: '저장하지 않은 변경 내용이 있어요',
    description: '지금 나가면 작성한 내용이 사라져요.',
    actions: (
      <>
        <Button variant="ghost">계속 작성하기</Button>
        <Button variant="primary">변경 내용 버리고 나가기</Button>
      </>
    ),
  },
} satisfies Meta<typeof Modal>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

export const 진행_중: Story = {
  args: {
    actions: (
      <>
        <Button variant="ghost" disabled>
          취소
        </Button>
        <Button variant="primary" loading>
          되돌리는 중
        </Button>
      </>
    ),
  },
}
