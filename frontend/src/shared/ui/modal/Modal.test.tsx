import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from './Modal'

/** 오버레이는 카드의 부모다 — Content 를 Overlay 안에 넣어 가운데 정렬을 시켰기 때문이다 */
function parts() {
  const card = screen.getByRole('dialog')
  const overlay = card.parentElement
  return { card, overlay }
}

describe('Modal', () => {
  it('draws nothing while closed', () => {
    render(<Modal open={false} onOpenChange={vi.fn()} title="팀을 삭제할까요?" />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('팀을 삭제할까요?')).toBeNull()
  })

  it('always draws the title element so Radix does not warn', () => {
    render(<Modal open onOpenChange={vi.fn()} title="팀을 삭제할까요?" />)

    const { card } = parts()
    expect(within(card).getByRole('heading')).toHaveTextContent('팀을 삭제할까요?')
  })

  it('draws the overlay, the scrim and the card with the measured values', () => {
    render(<Modal open onOpenChange={vi.fn()} title="팀을 삭제할까요?" />)
    const { card, overlay } = parts()

    expect(overlay).toHaveClass('fixed', 'inset-0', 'z-100', 'flex', 'items-center', 'p-24')

    const scrim = overlay?.querySelector('button')
    expect(scrim).toHaveClass('absolute', 'inset-0', 'bg-ink/32', 'cursor-pointer')

    expect(card).toHaveClass(
      'relative',
      'w-[380px]',
      'max-w-full',
      'p-24',
      'border-line',
      'rounded-16',
      'bg-surface',
      'flex',
      'flex-col',
      'gap-12',
    )
  })

  it('names the scrim for a11y and lets the caller replace the name', () => {
    const { rerender } = render(<Modal open onOpenChange={vi.fn()} title="팀을 삭제할까요?" />)
    expect(parts().overlay?.querySelector('button')).toHaveAttribute('aria-label', '닫기')

    rerender(<Modal open onOpenChange={vi.fn()} title="팀을 삭제할까요?" closeLabel="덮개 닫기" />)
    expect(parts().overlay?.querySelector('button')).toHaveAttribute('aria-label', '덮개 닫기')
  })

  it('puts no close X inside the card', () => {
    const { container } = render(<Modal open onOpenChange={vi.fn()} title="팀을 삭제할까요?" />)
    const { card } = parts()

    expect(within(card).queryAllByRole('button')).toHaveLength(0)
    expect(card.querySelector('svg')).toBeNull()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('bakes no button copy — the action row is whatever the caller passes', () => {
    render(
      <Modal
        open
        onOpenChange={vi.fn()}
        title="팀을 삭제할까요?"
        actions={
          <>
            <button type="button">그만두기</button>
            <button type="button">삭제</button>
          </>
        }
      />,
    )
    const { card } = parts()

    const names = within(card)
      .getAllByRole('button')
      .map((node) => node.textContent)
    expect(names).toEqual(['그만두기', '삭제'])
    expect(within(card).queryByText('취소')).toBeNull()
    expect(within(card).queryByText('확인')).toBeNull()

    const row = within(card).getByRole('button', { name: '삭제' }).parentElement
    expect(row).toHaveClass('flex', 'justify-end', 'gap-8', 'pt-6')
  })

  it('draws the description on the body step only when one is given', () => {
    const { rerender } = render(<Modal open onOpenChange={vi.fn()} title="팀을 삭제할까요?" />)
    expect(parts().card).not.toHaveAttribute('aria-describedby')

    rerender(
      <Modal
        open
        onOpenChange={vi.fn()}
        title="팀을 삭제할까요?"
        description="되돌릴 수 없습니다"
      />,
    )
    const { card } = parts()
    expect(card).toHaveAttribute('aria-describedby')
    expect(within(card).getByText('되돌릴 수 없습니다')).toHaveClass('text-body', 'text-sub')
  })

  it('renders the body children between the description and the actions', () => {
    render(
      <Modal
        open
        onOpenChange={vi.fn()}
        title="팀을 삭제할까요?"
        description="되돌릴 수 없습니다"
        actions={<button type="button">삭제</button>}
      >
        <p>남은 멤버 3명</p>
      </Modal>,
    )
    const { card } = parts()

    const text = Array.from(card.children).map((node) => node.textContent)
    expect(text).toEqual(['팀을 삭제할까요?', '되돌릴 수 없습니다', '남은 멤버 3명', '삭제'])
  })

  it('keeps the 380 default in the class and lets width override it inline', () => {
    const { rerender } = render(<Modal open onOpenChange={vi.fn()} title="팀을 삭제할까요?" />)
    expect(parts().card.style.width).toBe('')

    rerender(<Modal open onOpenChange={vi.fn()} title="팀을 삭제할까요?" width={520} />)
    expect(parts().card.style.width).toBe('520px')
    expect(parts().card).toHaveClass('max-w-full')
  })

  it('appends the caller className to the card without dropping its own classes', () => {
    render(<Modal open onOpenChange={vi.fn()} title="팀을 삭제할까요?" className="gap-8" />)

    expect(parts().card).toHaveClass('rounded-16', 'bg-surface', 'gap-8')
  })

  it('carries no open or close motion at all', () => {
    render(<Modal open onOpenChange={vi.fn()} title="팀을 삭제할까요?" />)
    const { card, overlay } = parts()

    const scrim = overlay?.querySelector('button')
    for (const node of [overlay, scrim, card]) {
      const names = node?.className.split(' ') ?? []
      expect(names.filter((name) => name.includes('transition'))).toEqual([])
      expect(names.filter((name) => name.includes('animate'))).toEqual([])
    }
  })

  it('reports a close when the scrim is clicked', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Modal open onOpenChange={onOpenChange} title="팀을 삭제할까요?" />)

    const scrim = parts().overlay?.querySelector('button')
    await user.click(scrim as HTMLButtonElement)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('reports a close on Esc', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Modal open onOpenChange={onOpenChange} title="팀을 삭제할까요?" />)

    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not close itself — the caller owns open', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Modal open onOpenChange={onOpenChange} title="팀을 삭제할까요?" />)

    await user.keyboard('{Escape}')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
