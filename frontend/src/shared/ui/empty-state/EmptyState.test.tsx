import { render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState'
import { Button } from '../button/Button'

/** 마스코트는 이 컴포넌트가 그리는 유일한 svg 다 */
function mascot(container: HTMLElement) {
  return container.querySelector('svg')
}

describe('EmptyState', () => {
  it('draws the mascot at 96 in the idle pose and keeps it decorative', () => {
    const { container } = render(<EmptyState title="아직 태스크가 없어요" />)

    const svg = mascot(container)
    expect(svg).toHaveAttribute('width', '96')
    expect(svg).toHaveAttribute('height', '96')
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).not.toHaveAttribute('aria-label')
  })

  it('lets the caller pick the pose and the mascot size', () => {
    const { container } = render(
      <EmptyState pose="squint" mascotSize={120} title="다 정리했어요" />,
    )

    expect(mascot(container)).toHaveAttribute('width', '120')
  })

  it('draws the measured container — column, centered, gap 26, max 460', () => {
    const { container } = render(<EmptyState title="아직 태스크가 없어요" />)

    expect(container.firstElementChild).toHaveClass(
      'flex',
      'flex-col',
      'items-center',
      'gap-26',
      'max-w-[460px]',
      'text-center',
    )
  })

  it('draws the title as an h1 on the measured step', () => {
    render(<EmptyState title="아직 태스크가 없어요" />)

    const title = screen.getByRole('heading', { level: 1 })
    expect(title).toHaveTextContent('아직 태스크가 없어요')
    expect(title).toHaveClass(
      'text-[24px]',
      'leading-[1.35]',
      'font-bold',
      'tracking-[-0.035em]',
      'text-ink',
    )
  })

  it('draws the description only when one is given, on its own step', () => {
    const { rerender, container } = render(<EmptyState title="아직 태스크가 없어요" />)
    expect(container.querySelector('p')).toBeNull()

    rerender(<EmptyState title="아직 태스크가 없어요" description="메일이 오면 여기에 쌓여요" />)

    const description = screen.getByText('메일이 오면 여기에 쌓여요')
    expect(description.tagName).toBe('P')
    expect(description).toHaveClass('text-[14px]', 'leading-[1.8]', 'text-sub')
  })

  it('stacks the title and the description in one 10px block', () => {
    render(<EmptyState title="아직 태스크가 없어요" description="메일이 오면 여기에 쌓여요" />)

    const block = screen.getByRole('heading', { level: 1 }).parentElement
    expect(block).toHaveClass('flex', 'flex-col', 'gap-10')
    expect(block?.children).toHaveLength(2)
  })

  it('draws no action row when neither action is given', () => {
    render(<EmptyState title="아직 태스크가 없어요" />)

    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('draws the measured action row for one or both actions', () => {
    const { rerender } = render(
      <EmptyState
        title="아직 태스크가 없어요"
        action={
          <Button variant="primary" size="lg">
            메일 연결하기
          </Button>
        }
      />,
    )

    const row = screen.getByRole('button', { name: '메일 연결하기' }).parentElement
    expect(row).toHaveClass('flex', 'items-center', 'gap-10', 'pt-2')
    expect(row?.children).toHaveLength(1)

    rerender(
      <EmptyState
        title="아직 태스크가 없어요"
        action={
          <Button variant="primary" size="lg">
            메일 연결하기
          </Button>
        }
        secondaryAction={<Button variant="text">나중에</Button>}
      />,
    )

    const names = screen.getAllByRole('button').map((node) => node.textContent)
    expect(names).toEqual(['메일 연결하기', '나중에'])
  })

  it('draws the row for a lone secondary action too', () => {
    render(<EmptyState title="아직 태스크가 없어요" secondaryAction={<Button>나중에</Button>} />)

    expect(screen.getByRole('button', { name: '나중에' }).parentElement).toHaveClass('pt-2')
  })

  it('bakes no copy — every string on screen came from the caller', () => {
    const { container } = render(
      <EmptyState title="아직 태스크가 없어요" description="메일이 오면 여기에 쌓여요" />,
    )

    expect(container.textContent).toBe('아직 태스크가 없어요메일이 오면 여기에 쌓여요')
  })

  it('appends the caller className without dropping its own classes', () => {
    const { container } = render(<EmptyState title="아직 태스크가 없어요" className="gap-10" />)

    expect(container.firstElementChild).toHaveClass('max-w-[460px]', 'text-center', 'gap-10')
  })
})
