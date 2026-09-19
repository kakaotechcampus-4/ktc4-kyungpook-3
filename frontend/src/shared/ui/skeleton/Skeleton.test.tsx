import { render, screen } from '@testing-library/react'
import { Skeleton } from './Skeleton'
import type { SkeletonVariant } from './Skeleton'

const RADIUS_CASES: Array<[SkeletonVariant, string]> = [
  ['text', 'rounded-6'],
  ['block', 'rounded-12'],
  ['circle', 'rounded-999'],
]

const VARIANTS: SkeletonVariant[] = ['text', 'block', 'circle']

/** 한 요소에 붙은 animation 유틸만 골라낸다 */
function animationClassesOf(element: Element): string[] {
  return element.className.split(' ').filter((name) => name.includes('animate-'))
}

describe('Skeleton', () => {
  it('falls back to the text variant', () => {
    render(<Skeleton data-testid="bone" />)

    expect(screen.getByTestId('bone')).toHaveClass('rounded-6', 'h-12', 'w-full')
  })

  it.each(VARIANTS)('draws the %s variant on the selected surface', (variant) => {
    render(<Skeleton variant={variant} data-testid="bone" />)

    expect(screen.getByTestId('bone')).toHaveClass('bg-surface-selected')
  })

  it.each(RADIUS_CASES)('gives the %s variant its radius', (variant, expected) => {
    render(<Skeleton variant={variant} data-testid="bone" />)

    expect(screen.getByTestId('bone')).toHaveClass(expected)
  })

  it('hides itself from assistive technology', () => {
    render(<Skeleton data-testid="bone" />)

    expect(screen.getByTestId('bone')).toHaveAttribute('aria-hidden', 'true')
  })

  it('leaves aria-busy to the caller container', () => {
    render(<Skeleton data-testid="bone" />)

    expect(screen.getByTestId('bone')).not.toHaveAttribute('aria-busy')
  })

  it('breathes for 1.6s on opacity only', () => {
    render(<Skeleton data-testid="bone" />)

    expect(animationClassesOf(screen.getByTestId('bone'))).toEqual([
      'motion-safe:animate-[skeleton-breathe_1.6s_ease-in-out_infinite]',
    ])
  })

  it.each(VARIANTS)('stops the %s animation under prefers-reduced-motion', (variant) => {
    render(<Skeleton variant={variant} data-testid="bone" />)
    const animations = animationClassesOf(screen.getByTestId('bone'))

    // 애니메이션은 motion-safe: 하나뿐이다 — 줄이기를 켜면 규칙이 아예 안 걸리고 면만 남는다
    expect(animations).toHaveLength(1)
    expect(animations[0].startsWith('motion-safe:')).toBe(true)
  })

  it('never draws a gradient, a shimmer translate or a spinner', () => {
    const { container } = render(<Skeleton data-testid="bone" />)
    const bone = screen.getByTestId('bone')

    expect(bone.className).not.toMatch(/gradient|translate|spin/)
    expect(container.querySelector('svg')).toBeNull()
  })

  it('turns width and height into inline styles', () => {
    render(<Skeleton variant="circle" width={40} height={40} data-testid="bone" />)
    const bone = screen.getByTestId('bone')

    expect(bone).toHaveStyle({ width: '40px', height: '40px' })
  })

  it('accepts string sizes too', () => {
    render(<Skeleton variant="block" width="12rem" height="80px" data-testid="bone" />)

    expect(screen.getByTestId('bone')).toHaveStyle({ width: '12rem', height: '80px' })
  })

  it('stacks the requested number of text lines behind one hidden wrapper', () => {
    render(<Skeleton lines={3} data-testid="bones" />)
    const wrapper = screen.getByTestId('bones')

    expect(wrapper).toHaveAttribute('aria-hidden', 'true')
    expect(wrapper).toHaveClass('flex', 'flex-col', 'gap-8')
    expect(wrapper.children).toHaveLength(3)
  })

  it('cuts the last line to 60% width', () => {
    render(<Skeleton lines={3} data-testid="bones" />)
    const lines = Array.from(screen.getByTestId('bones').children)

    expect(lines[0]).toHaveClass('w-full')
    expect(lines[1]).toHaveClass('w-full')
    expect(lines[2]).toHaveClass('w-[60%]')
    expect(lines[2]).not.toHaveClass('w-full')
  })

  it('animates every line the same motion-safe way', () => {
    render(<Skeleton lines={2} data-testid="bones" />)

    for (const line of Array.from(screen.getByTestId('bones').children)) {
      expect(animationClassesOf(line)).toEqual([
        'motion-safe:animate-[skeleton-breathe_1.6s_ease-in-out_infinite]',
      ])
    }
  })

  it('renders nothing but the wrapper when lines is 0', () => {
    render(<Skeleton lines={0} data-testid="bones" />)

    expect(screen.getByTestId('bones').children).toHaveLength(0)
  })

  it('ignores lines outside the text variant', () => {
    render(<Skeleton variant="block" lines={3} data-testid="bone" />)
    const bone = screen.getByTestId('bone')

    expect(bone.children).toHaveLength(0)
    expect(bone).toHaveClass('rounded-12')
  })

  it('keeps its own classes when the caller adds layout', () => {
    render(<Skeleton className="mt-12" data-testid="bone" />)

    expect(screen.getByTestId('bone')).toHaveClass('mt-12', 'bg-surface-selected', 'rounded-6')
  })
})
