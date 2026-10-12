import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Popover, PopoverContent, PopoverTrigger } from './Popover'

function Demo() {
  return (
    <Popover>
      <PopoverTrigger className="inline-flex h-36 items-center rounded-9 border border-line px-11 text-control font-semibold">
        더 보기
      </PopoverTrigger>
      <PopoverContent aria-label="더 보기 내용">
        <p className="text-meta font-semibold text-dim">묶음 제목</p>
        <p className="text-body">팝오버 안의 내용이에요.</p>
      </PopoverContent>
    </Popover>
  )
}

const meta = {
  title: 'M5 공통/Popover',
  component: Demo,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

export const 닫힘: Story = {}

/** 키보드로 연다 — 포커스가 안으로 가고, Esc 로 닫으면 트리거로 돌아온다 */
export const 열림: Story = {
  play: async ({ canvasElement }) => {
    const trigger = within(canvasElement).getByRole('button', { name: '더 보기' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const dialog = await within(document.body).findByRole('dialog', { name: '더 보기 내용' })
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    await expect(trigger).toHaveFocus()
    // 다시 열어 둔 모습으로 끝낸다
    await userEvent.keyboard('{Enter}')
    await expect(
      await within(document.body).findByRole('dialog', { name: '더 보기 내용' }),
    ).toBeVisible()
  },
}
