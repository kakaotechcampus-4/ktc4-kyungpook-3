import type { Meta, StoryObj } from '@storybook/react-vite'
import { ApiError } from '../../api/errors'
import { QueryErrorState } from './QueryErrorState'

const meta = {
  title: 'M2 공통 UI/QueryErrorState',
  component: QueryErrorState,
  args: {
    error: new ApiError({ code: 'INTERNAL_ERROR', message: 'boom', details: null }, 500),
    onRetry: () => undefined,
  },
  parameters: { layout: 'centered' },
} satisfies Meta<typeof QueryErrorState>

export default meta
type Story = StoryObj<typeof meta>

/** 조회 실패 — 인라인 안내 + 다시 시도 */
export const 오류: Story = {}

export const 네트워크: Story = {
  args: {
    error: new ApiError({ code: 'NETWORK_ERROR', message: 'offline', details: null }, 0, 'network'),
  },
}
