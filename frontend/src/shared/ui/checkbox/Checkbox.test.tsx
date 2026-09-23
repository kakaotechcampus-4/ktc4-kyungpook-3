import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Checkbox } from './Checkbox'

describe('Checkbox', () => {
  it('renders a checkbox and the label given as children', () => {
    render(<Checkbox>이용약관에 동의합니다</Checkbox>)

    expect(screen.getByRole('checkbox')).toBeInTheDocument()
    expect(screen.getByText('이용약관에 동의합니다')).toBeInTheDocument()
  })

  it('wires the label to the box with a generated id', () => {
    render(<Checkbox>이용약관에 동의합니다</Checkbox>)
    const box = screen.getByRole('checkbox')
    const label = screen.getByText('이용약관에 동의합니다')

    expect(box.id).not.toBe('')
    expect(label).toHaveAttribute('for', box.id)
  })

  it('uses the id given by the caller instead of the generated one', () => {
    render(<Checkbox id="terms">이용약관에 동의합니다</Checkbox>)

    expect(screen.getByRole('checkbox')).toHaveAttribute('id', 'terms')
  })

  it('draws no label when no children are given', () => {
    const { container } = render(<Checkbox aria-label="이용약관에 동의합니다" />)

    expect(container.querySelector('label')).toBeNull()
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  it('draws the unchecked box on the input border', () => {
    render(<Checkbox />)
    const box = screen.getByRole('checkbox')

    expect(box).toHaveAttribute('data-state', 'unchecked')
    expect(box).toHaveClass('h-18', 'w-18', 'rounded-6', 'border', 'bg-surface')
    expect(box).toHaveClass('border-input-border')
  })

  it('turns the ink fill on and draws the check svg when checked', () => {
    const { container } = render(<Checkbox checked />)
    const box = screen.getByRole('checkbox')

    expect(box).toHaveAttribute('aria-checked', 'true')
    expect(box).toHaveAttribute('data-state', 'checked')
    expect(box).toHaveClass(
      'data-[state=checked]:bg-ink',
      'data-[state=checked]:border-transparent',
    )

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('stroke-width', '3.2')
    expect(svg).toHaveAttribute('stroke-linecap', 'round')
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
    expect(container.querySelector('svg path')).toHaveAttribute('d', 'm20 6-11 11-5-5')
  })

  it('draws the bar instead of the check when indeterminate', () => {
    const { container } = render(<Checkbox checked="indeterminate" />)
    const box = screen.getByRole('checkbox')

    expect(box).toHaveAttribute('aria-checked', 'mixed')
    expect(box).toHaveAttribute('data-state', 'indeterminate')
    expect(box).toHaveClass('data-[state=indeterminate]:bg-ink')
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('span.bg-surface')).toHaveClass('h-2', 'w-9', 'rounded-999')
  })

  it('swaps the border for the accent when invalid and marks it for a11y', () => {
    render(<Checkbox invalid>이용약관에 동의합니다</Checkbox>)
    const box = screen.getByRole('checkbox')

    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveClass('border-accent')
    expect(box).not.toHaveClass('border-input-border')
  })

  it('leaves the invalid wiring off by default', () => {
    render(<Checkbox />)

    expect(screen.getByRole('checkbox')).not.toHaveAttribute('aria-invalid')
  })

  it('fills the box with the inactive mark when disabled', () => {
    render(<Checkbox disabled />)
    const box = screen.getByRole('checkbox')

    expect(box).toBeDisabled()
    expect(box).toHaveClass('bg-inactive', 'data-[state=unchecked]:border-line-strong')
    expect(box).not.toHaveClass('border-input-border')
  })

  it('darkens the unchecked border on hover and press', () => {
    render(<Checkbox />)

    expect(screen.getByRole('checkbox')).toHaveClass(
      'data-[state=unchecked]:hover:border-ink',
      'data-[state=unchecked]:active:border-ink',
    )
  })

  it('toggles with the keyboard', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Checkbox onCheckedChange={onCheckedChange}>이용약관에 동의합니다</Checkbox>)

    await user.tab()
    expect(screen.getByRole('checkbox')).toHaveFocus()

    await user.keyboard('[Space]')
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })

  it('does not toggle when disabled', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<Checkbox disabled onCheckedChange={onCheckedChange} />)

    await user.click(screen.getByRole('checkbox'))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('appends the caller className to the row without dropping its own classes', () => {
    const { container } = render(<Checkbox className="mt-12" />)
    const row = container.firstElementChild

    expect(row).toHaveClass('flex', 'items-start', 'gap-10', 'mt-12')
  })

  it('draws a white focus line inside the ink face when checked or indeterminate', () => {
    render(<Checkbox checked />)

    expect(screen.getByRole('checkbox')).toHaveClass(
      'data-[state=checked]:focus-visible:outline-surface',
      'data-[state=checked]:focus-visible:-outline-offset-3',
      'data-[state=indeterminate]:focus-visible:outline-surface',
      'data-[state=indeterminate]:focus-visible:-outline-offset-3',
    )
  })

  it('leaves the unchecked box on the global focus line', () => {
    render(<Checkbox />)

    expect(screen.getByRole('checkbox').className).not.toMatch(
      /data-\[state=unchecked\]:focus-visible:/,
    )
  })

  it('draws the focus line in the accent on an invalid box and keeps the white line when checked', () => {
    render(<Checkbox invalid>이용약관에 동의합니다</Checkbox>)
    const box = screen.getByRole('checkbox')

    expect(box).toHaveClass(
      'focus-visible:outline-accent',
      'data-[state=checked]:focus-visible:outline-surface',
      'data-[state=indeterminate]:focus-visible:outline-surface',
    )
  })

  it('leaves the accent focus line off the default box', () => {
    render(<Checkbox />)

    expect(screen.getByRole('checkbox').className).not.toMatch(/outline-accent/)
  })
})
