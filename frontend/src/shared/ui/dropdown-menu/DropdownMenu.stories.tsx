import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './DropdownMenu'

function Demo({ disabled }: { disabled?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-36 items-center rounded-9 border border-line px-11 text-control font-semibold">
        메뉴 열기
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>묶음 제목</DropdownMenuLabel>
        <DropdownMenuItem>첫 항목</DropdownMenuItem>
        <DropdownMenuItem>둘째 항목</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={disabled}>비활성일 수 있는 항목</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const meta = {
  title: 'M4 공통/DropdownMenu',
  component: Demo,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const 닫힘: Story = {}

/** 키보드로 연다 — 첫 항목에 포커스, 화살표 이동, Esc 로 닫으면 트리거로 돌아온다 */
export const 열림: Story = {
  play: async ({ canvasElement }) => {
    within(canvasElement).getByRole('button', { name: '메뉴 열기' }).focus()
    await userEvent.keyboard('{Enter}')
    await expect(within(document.body).getByRole('menu')).toBeInTheDocument()
  },
}

export const 비활성_항목: Story = { ...열림, args: { disabled: true } }
