import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectCard, SelectCardGroup } from './SelectCard'

function renderGroup(props?: { value?: string; onValueChange?: (value: string) => void }) {
  return render(
    <SelectCardGroup
      aria-label="자동 반영 기준"
      defaultValue={props?.value ?? 'all'}
      onValueChange={props?.onValueChange}
    >
      <SelectCard
        value="all"
        title="전부 내가 확인한다"
        description="회의에서 나온 모든 항목이 확인 대기로 올라옵니다"
      />
      <SelectCard
        value="clear"
        title="담당자·마감이 분명한 건만 자동으로"
        description="나머지는 확인 대기로 올라옵니다"
      />
      <SelectCard
        value="auto"
        disabled
        title="전부 자동으로 올린다"
        description="지원하지 않습니다"
      />
    </SelectCardGroup>,
  )
}

describe('SelectCard', () => {
  it('renders a radiogroup of radio cards', () => {
    renderGroup()

    expect(screen.getByRole('radiogroup', { name: '자동 반영 기준' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('renders the title and the description given by the caller', () => {
    renderGroup()

    expect(screen.getByText('전부 내가 확인한다')).toBeInTheDocument()
    expect(screen.getByText('회의에서 나온 모든 항목이 확인 대기로 올라옵니다')).toBeInTheDocument()
  })

  it('stacks the cards 14px apart', () => {
    const { container } = renderGroup()

    expect(container.firstElementChild).toHaveClass('flex', 'flex-col', 'gap-14')
  })

  it('draws the unselected card on the plain line', () => {
    renderGroup()
    const card = screen.getByRole('radio', { name: /담당자/ })

    expect(card).toHaveAttribute('data-state', 'unchecked')
    expect(card).toHaveClass('rounded-16', 'border', 'border-line', 'bg-surface', 'px-18', 'py-16')
  })

  it('uses the strong line — not ink — for the selected border', () => {
    renderGroup()
    const card = screen.getByRole('radio', { name: /전부 내가 확인한다/ })

    expect(card).toHaveAttribute('data-state', 'checked')
    expect(card).toHaveClass('data-[state=checked]:border-line-strong')
    expect(card.className).not.toContain('border-ink')
  })

  it('draws the 8px dot only inside the selected card', () => {
    renderGroup()
    const selected = screen.getByRole('radio', { name: /전부 내가 확인한다/ })
    const other = screen.getByRole('radio', { name: /담당자/ })

    expect(selected.querySelector('span.bg-ink')).toHaveClass('h-8', 'w-8', 'rounded-999')
    expect(other.querySelector('span.bg-ink')).toBeNull()
  })

  it('lays the radio mark beside the text', () => {
    renderGroup()
    const card = screen.getByRole('radio', { name: /담당자/ })

    expect(card).toHaveClass('flex', 'items-start', 'gap-13')
    expect(card.firstElementChild).toHaveClass('h-[17px]', 'w-[17px]', 'mt-3', 'border-faint')
  })

  it('dims the title and the mark on a disabled card', () => {
    renderGroup()
    const card = screen.getByRole('radio', { name: /전부 자동으로/ })

    expect(card).toBeDisabled()
    expect(card.firstElementChild).toHaveClass('border-line-strong')
    expect(screen.getByText('전부 자동으로 올린다')).toHaveClass('text-dim')
    expect(card.className).not.toContain('data-[state=checked]:border-line-strong')
  })

  it('darkens the description only on the selected card', () => {
    renderGroup()

    expect(screen.getByText('회의에서 나온 모든 항목이 확인 대기로 올라옵니다')).toHaveClass(
      'text-caption',
      'group-data-[state=checked]:text-sub',
    )
  })

  it('roves the focus with the arrow keys and picks with the spacebar', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderGroup({ onValueChange })

    await user.tab()
    expect(screen.getByRole('radio', { name: /전부 내가 확인한다/ })).toHaveFocus()

    await user.keyboard('[ArrowDown]')
    expect(screen.getByRole('radio', { name: /담당자/ })).toHaveFocus()

    await user.keyboard('[Space]')
    expect(onValueChange).toHaveBeenCalledWith('clear')
    expect(screen.getByRole('radio', { name: /담당자/ })).toHaveAttribute('data-state', 'checked')
  })

  it('does not select a disabled card on click', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderGroup({ onValueChange })

    await user.click(screen.getByRole('radio', { name: /전부 자동으로/ }))
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('appends the caller className without dropping the card classes', () => {
    render(
      <SelectCardGroup aria-label="자동 반영 기준">
        <SelectCard value="all" className="mt-12" title="전부 내가 확인한다" />
      </SelectCardGroup>,
    )

    expect(screen.getByRole('radio')).toHaveClass('mt-12', 'rounded-16')
  })
})
