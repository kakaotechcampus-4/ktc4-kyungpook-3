import { render, screen } from '@testing-library/react'
import { Card } from './Card'
import type { CardVariant } from './Card'

const RADIUS_CASES: Array<[CardVariant, string]> = [
  ['default', 'rounded-16'],
  ['attention', 'rounded-16'],
  ['pending', 'rounded-16'],
  ['onboarding', 'rounded-10'],
]

const PADDING_CASES: Array<[CardVariant, string]> = [
  ['default', 'px-20 py-18'],
  ['attention', 'px-30 py-28'],
  ['pending', 'px-22 py-20'],
  ['onboarding', 'px-22 pt-22 pb-18'],
]

const VARIANTS: CardVariant[] = ['default', 'attention', 'pending', 'onboarding']

describe('Card', () => {
  it('renders its children in a div by default', () => {
    render(<Card data-testid="card">확인 필요</Card>)
    const card = screen.getByTestId('card')

    expect(card.tagName).toBe('DIV')
    expect(card).toHaveTextContent('확인 필요')
  })

  it('falls back to the default variant', () => {
    render(<Card data-testid="card">확인 필요</Card>)

    expect(screen.getByTestId('card')).toHaveClass(
      'bg-surface',
      'rounded-16',
      'border',
      'border-line',
    )
  })

  it.each(VARIANTS)('draws the %s variant on the white surface', (variant) => {
    render(
      <Card variant={variant} data-testid="card">
        확인 필요
      </Card>,
    )

    expect(screen.getByTestId('card')).toHaveClass('bg-surface')
  })

  it.each(RADIUS_CASES)('gives the %s variant its radius', (variant, expected) => {
    render(
      <Card variant={variant} data-testid="card">
        확인 필요
      </Card>,
    )

    expect(screen.getByTestId('card')).toHaveClass(expected)
  })

  it.each(PADDING_CASES)('gives the %s variant one representative padding', (variant, expected) => {
    render(
      <Card variant={variant} data-testid="card">
        확인 필요
      </Card>,
    )

    expect(screen.getByTestId('card')).toHaveClass(...expected.split(' '))
  })

  it('marks attention with the strong border line, not ink and not a shadow', () => {
    render(
      <Card variant="attention" data-testid="card">
        확인 필요
      </Card>,
    )
    const card = screen.getByTestId('card')

    expect(card).toHaveClass('border', 'border-line-strong')
    expect(card).not.toHaveClass('border-ink')
    expect(card.className).not.toMatch(/shadow/)
  })

  it('draws pending as a 2px dashed line in the dashed token colour', () => {
    render(
      <Card variant="pending" data-testid="card">
        보류
      </Card>,
    )
    const card = screen.getByTestId('card')

    // border-dashed 한 이름이 모양(dashed)과 색(--color-dashed)을 같이 낸다
    expect(card).toHaveClass('border-2', 'border-dashed')
    expect(card).not.toHaveClass('border-line', 'border-line-strong')
  })

  it.each(VARIANTS)('never puts a shadow on the %s variant', (variant) => {
    render(
      <Card variant={variant} data-testid="card">
        확인 필요
      </Card>,
    )

    expect(screen.getByTestId('card').className).not.toMatch(/shadow/)
  })

  it('never reaches for the 28px auth side-card radius', () => {
    render(
      <Card variant="onboarding" data-testid="card">
        팀 만들기
      </Card>,
    )

    expect(screen.getByTestId('card').className).not.toMatch(/rounded-28/)
  })

  it('renders the tag given by as', () => {
    const { rerender } = render(
      <Card as="article" data-testid="card">
        확인 필요
      </Card>,
    )
    expect(screen.getByTestId('card').tagName).toBe('ARTICLE')

    rerender(
      <Card as="section" data-testid="card">
        확인 필요
      </Card>,
    )
    expect(screen.getByTestId('card').tagName).toBe('SECTION')

    rerender(
      <Card as="label" data-testid="card">
        확인 필요
      </Card>,
    )
    expect(screen.getByTestId('card').tagName).toBe('LABEL')
  })

  it('keeps the variant classes when the caller adds layout', () => {
    render(
      <Card className="mt-12" data-testid="card">
        확인 필요
      </Card>,
    )

    expect(screen.getByTestId('card')).toHaveClass('mt-12', 'rounded-16', 'border-line')
  })

  it('forwards the rest of the div props', () => {
    render(
      <Card data-testid="card" id="task-1" aria-label="확인 필요 태스크">
        확인 필요
      </Card>,
    )
    const card = screen.getByTestId('card')

    expect(card).toHaveAttribute('id', 'task-1')
    expect(card).toHaveAttribute('aria-label', '확인 필요 태스크')
  })
})
