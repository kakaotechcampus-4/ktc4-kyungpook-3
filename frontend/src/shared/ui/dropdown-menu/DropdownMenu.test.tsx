import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './DropdownMenu'

function renderMenu(onPick = vi.fn<(value: string) => void>()) {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>메뉴</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>묶음</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onPick('하나')}>하나</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick('둘')}>둘</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>못 고름</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  )
  return onPick
}

describe('DropdownMenu', () => {
  it('누르면 열리고 항목을 고르면 닫힌다', async () => {
    const onPick = renderMenu()
    await userEvent.click(screen.getByRole('button', { name: '메뉴' }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('separator')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: '둘' }))
    expect(onPick).toHaveBeenCalledWith('둘')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('키보드: 화살표로 옮기고 비활성은 건너뛰며 Esc 로 닫으면 트리거로 돌아온다', async () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: '메뉴' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '하나' })).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: '둘' })).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    // 비활성 항목에는 머물지 않고 처음으로 돌지 않는다
    expect(screen.getByRole('menuitem', { name: '둘' })).toHaveFocus()
    // Home 은 처음, End 는 끝(비활성 제외)이다
    await userEvent.keyboard('{Home}')
    expect(screen.getByRole('menuitem', { name: '하나' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('menuitem', { name: '둘' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('고른 줄은 선택 면이다 — 그림자 없이 테두리 한 겹이다', async () => {
    renderMenu()
    await userEvent.click(screen.getByRole('button', { name: '메뉴' }))
    const menu = await screen.findByRole('menu')
    expect(menu.className).toContain('border-line')
    expect(menu.className).not.toMatch(/shadow/)
    expect(screen.getByRole('menuitem', { name: '하나' }).className).toContain(
      'data-[highlighted]:bg-surface-selected',
    )
  })
})
