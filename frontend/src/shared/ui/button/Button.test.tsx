import { render, screen } from '@testing-library/react'
import { Button } from './Button'
import type { ButtonSize, ButtonVariant } from './Button'

const VARIANT_CASES: Array<[ButtonVariant, string]> = [
  ['primary', 'bg-ink text-surface'],
  ['default', 'border border-transparent bg-control text-ink'],
  ['ghost', 'bg-transparent text-sub'],
  ['text', 'bg-transparent text-faint'],
  ['outline', 'border border-line bg-surface text-ink'],
]

const SIZE_CASES: Array<[ButtonSize, string]> = [
  ['sm', 'h-32 rounded-9 px-12 text-control'],
  ['md', 'h-36 rounded-9 px-20 text-control'],
  ['md-compact', 'h-34 rounded-9 px-13 text-caption'],
  ['lg', 'h-40 rounded-9 px-20 text-body'],
  ['lg-onboarding', 'h-40 rounded-8 px-18 text-body'],
  ['xl', 'h-44 rounded-9 px-22 text-[14.5px]'],
  ['auth', 'h-48 w-full rounded-999 text-[15px]'],
  ['landing-hero', 'h-44 rounded-999 px-24 text-landing'],
  ['landing-nav', 'h-[38px] rounded-999 px-18 text-[15px]'],
]

describe('Button', () => {
  it('renders the label given as children', () => {
    render(<Button>승인</Button>)

    expect(screen.getByRole('button', { name: '승인' })).toBeInTheDocument()
  })

  it('falls back to the default variant at md size', () => {
    render(<Button>승인</Button>)

    expect(screen.getByRole('button')).toHaveClass('bg-control', 'text-ink', 'h-36', 'text-control')
  })

  it.each(VARIANT_CASES)('draws the %s variant surface', (variant, expected) => {
    render(<Button variant={variant}>승인</Button>)

    expect(screen.getByRole('button')).toHaveClass(...expected.split(' '))
  })

  it.each(SIZE_CASES)('draws the %s size box', (size, expected) => {
    render(<Button size={size}>승인</Button>)

    expect(screen.getByRole('button')).toHaveClass(...expected.split(' '))
  })

  it('disables the button when disabled is passed', () => {
    render(<Button disabled>승인</Button>)

    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('treats loading as disabled + aria-busy and draws no spinner', () => {
    const { container } = render(<Button loading>승인</Button>)
    const button = screen.getByRole('button')

    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveTextContent('승인')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('leaves aria-busy off when not loading', () => {
    render(<Button>승인</Button>)

    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy')
  })

  it('stretches to the full width when fullWidth is set', () => {
    render(<Button fullWidth>승인</Button>)

    expect(screen.getByRole('button')).toHaveClass('w-full')
  })

  it('renders the start and end icons around the label', () => {
    render(
      <Button startIcon={<span data-testid="start" />} endIcon={<span data-testid="end" />}>
        승인
      </Button>,
    )

    expect(screen.getByTestId('start')).toBeInTheDocument()
    expect(screen.getByTestId('end')).toBeInTheDocument()
  })

  it('uses 700 only for the onboarding confirm button', () => {
    const { rerender } = render(
      <Button size="lg-onboarding" variant="primary">
        만들기
      </Button>,
    )

    expect(screen.getByRole('button')).toHaveClass('font-bold')
    expect(screen.getByRole('button')).not.toHaveClass('font-semibold')

    rerender(
      <Button size="lg-onboarding" variant="ghost">
        이전
      </Button>,
    )

    expect(screen.getByRole('button')).toHaveClass('font-semibold')
    expect(screen.getByRole('button')).not.toHaveClass('font-bold')
  })

  it('keeps 600 for every other size', () => {
    render(<Button variant="primary">승인</Button>)

    expect(screen.getByRole('button')).toHaveClass('font-semibold')
  })

  it('appends the caller className without dropping its own classes', () => {
    render(<Button className="mt-12">승인</Button>)

    expect(screen.getByRole('button')).toHaveClass('mt-12', 'h-36')
  })

  it('keeps aria-disabled buttons focusable', () => {
    render(<Button aria-disabled>이전</Button>)
    const button = screen.getByRole('button')

    expect(button).not.toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('draws a white focus line inside the ink face of primary', () => {
    render(<Button variant="primary">승인</Button>)

    expect(screen.getByRole('button')).toHaveClass(
      'focus-visible:outline-surface',
      'focus-visible:-outline-offset-3',
    )
  })

  it('returns aria-disabled primary to the ink focus line — the face is light there', () => {
    render(
      <Button variant="primary" aria-disabled="true">
        승인
      </Button>,
    )

    expect(screen.getByRole('button')).toHaveClass(
      'aria-disabled:focus-visible:outline-ink',
      'aria-disabled:focus-visible:-outline-offset-1',
    )
  })

  it.each(['default', 'ghost', 'text', 'outline'] as const)(
    'leaves the %s variant on the global focus line',
    (variant) => {
      render(<Button variant={variant}>승인</Button>)

      expect(screen.getByRole('button').className).not.toMatch(/focus-visible:/)
    },
  )
})
