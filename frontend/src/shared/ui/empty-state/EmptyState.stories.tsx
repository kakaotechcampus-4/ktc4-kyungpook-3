import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../button/Button'
import { EmptyState } from './EmptyState'

const meta = {
  title: 'M2 공통 UI/EmptyState',
  component: EmptyState,
  args: {
    title: '아직 회의록이 없어요',
    description: '회의 녹음을 올리면 결정사항과 담당자, 마감을 정리해 드려요.',
    action: (
      <Button variant="primary" size="lg">
        회의 올리기
      </Button>
    ),
    secondaryAction: <Button size="lg">텍스트로 붙여넣기</Button>,
  },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

export const 기본: Story = {}

export const 완료: Story = { args: { pose: 'squint', title: '확인할 일을 모두 마쳤어요' } }
