import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../button/Button'
import { FormErrorPanel } from './FormErrorPanel'

const meta = {
  title: 'M4 폼/FormErrorPanel',
  component: FormErrorPanel,
  args: { message: '이메일 또는 비밀번호가 올바르지 않아요.' },
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-[384px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FormErrorPanel>

export default meta
type Story = StoryObj<typeof meta>

/** 비필드 오류 — 눌린 면 + 먹 본문 (§7-13) */
export const 오류: Story = {}

export const 대체_경로: Story = {
  args: {
    message: '서버에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.',
    action: <Button size="sm">다시 시도</Button>,
  },
}

/** 문구가 없으면 아무것도 그리지 않는다 */
export const 없음: Story = { args: { message: null } }
