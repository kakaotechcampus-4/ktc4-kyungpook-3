import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Popover, PopoverContent, PopoverTrigger } from './Popover'

function renderPopover() {
  render(
    <>
      <Popover>
        <PopoverTrigger>열기</PopoverTrigger>
        <PopoverContent aria-label="내용">
          <p>떠 있는 면</p>
        </PopoverContent>
      </Popover>
      <button type="button">바깥</button>
    </>,
  )
  return screen.getByRole('button', { name: '열기' })
}

describe('Popover', () => {
  it('키보드로 열면 포커스가 안으로 가고, Esc 로 닫으면 트리거로 돌아온다', async () => {
    const user = userEvent.setup()
    const trigger = renderPopover()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    trigger.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '내용' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', dialog.id)
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(trigger).toHaveFocus()
  })

  it('바깥을 누르면 닫힌다', async () => {
    const user = userEvent.setup()
    const trigger = renderPopover()
    await user.click(trigger)
    expect(await screen.findByRole('dialog', { name: '내용' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '바깥' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('면은 테두리 한 겹이고 그림자가 없다', async () => {
    const user = userEvent.setup()
    await user.click(renderPopover())
    const dialog = await screen.findByRole('dialog', { name: '내용' })
    expect(dialog.className).toContain('border-line')
    expect(dialog.className).not.toMatch(/shadow/)
  })
})
