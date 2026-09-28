import { render, screen } from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { Segmented, SegmentedItem } from './Segmented'
import type { SegmentedSize } from './Segmented'

const SIZE_CASES: Array<[SegmentedSize, string]> = [
  ['sm', 'h-30 px-13 text-caption'],
  ['md', 'h-32 px-15 text-control'],
]

function renderSegmented(props?: { value?: string; onValueChange?: (value: string) => void }) {
  const onValueChange = props?.onValueChange ?? (() => undefined)

  return render(
    <Segmented aria-label="보기 방식" value={props?.value ?? 'list'} onValueChange={onValueChange}>
      <SegmentedItem value="list">목록</SegmentedItem>
      <SegmentedItem value="board">보드</SegmentedItem>
      <SegmentedItem value="calendar" disabled>
        달력
      </SegmentedItem>
    </Segmented>,
  )
}

describe('Segmented', () => {
  it('renders a radiogroup named by the required aria-label', () => {
    renderSegmented()

    expect(screen.getByRole('radiogroup', { name: '보기 방식' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('draws the track', () => {
    const { container } = renderSegmented()

    expect(container.firstElementChild).toHaveClass(
      'inline-flex',
      'gap-3',
      'p-3',
      'border',
      'border-transparent',
      'rounded-11',
      'bg-control',
    )
  })

  it('keeps the 36px render height the artboard actually shows', () => {
    renderSegmented()

    expect(screen.getByRole('radio', { name: '목록' })).toHaveClass('min-h-36')
  })

  it('draws the selected item on the white handle and the rest on the sub grey', () => {
    renderSegmented()
    const selected = screen.getByRole('radio', { name: '목록' })
    const other = screen.getByRole('radio', { name: '보드' })

    expect(selected).toHaveAttribute('data-state', 'on')
    expect(selected).toHaveClass('data-[state=on]:bg-surface', 'data-[state=on]:text-ink')
    expect(other).toHaveAttribute('data-state', 'off')
    expect(other).toHaveClass('text-sub')
  })

  it('falls back to the sm size', () => {
    renderSegmented()

    expect(screen.getByRole('radio', { name: '목록' })).toHaveClass(
      'h-30',
      'px-13',
      'text-caption',
      'font-semibold',
    )
  })

  it.each(SIZE_CASES)('hands the %s size down to every item', (size, expected) => {
    render(
      <Segmented aria-label="보기 방식" size={size} value="list" onValueChange={() => undefined}>
        <SegmentedItem value="list">목록</SegmentedItem>
        <SegmentedItem value="board">보드</SegmentedItem>
      </Segmented>,
    )

    for (const item of screen.getAllByRole('radio')) {
      expect(item).toHaveClass(...expected.split(' '))
    }
  })

  it('ignores the empty value so one item always stays selected', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderSegmented({ onValueChange })

    await user.click(screen.getByRole('radio', { name: '목록' }))
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('reports the new value when another item is picked', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderSegmented({ onValueChange })

    await user.click(screen.getByRole('radio', { name: '보드' }))
    expect(onValueChange).toHaveBeenCalledWith('board')
  })

  it('moves between items with the arrow keys', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    renderSegmented({ onValueChange })

    await user.tab()
    expect(screen.getByRole('radio', { name: '목록' })).toHaveFocus()

    await user.keyboard('[ArrowRight]')
    expect(screen.getByRole('radio', { name: '보드' })).toHaveFocus()
  })

  it('takes the pointer off a disabled item', async () => {
    // pointer-events 를 껐으므로 user-event 의 기본 검사를 끄고 눌러 본다
    const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
    const onValueChange = vi.fn()
    renderSegmented({ onValueChange })
    const disabled = screen.getByRole('radio', { name: '달력' })

    expect(disabled).toBeDisabled()
    expect(disabled).toHaveClass('pointer-events-none', 'text-line-strong')
    expect(disabled.className).not.toContain('data-[state=off]:hover:text-ink')

    await user.click(disabled)
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('lifts hover onto the unselected items only and keeps the face still on press', () => {
    renderSegmented()

    expect(screen.getByRole('radio', { name: '보드' })).toHaveClass(
      'data-[state=off]:hover:text-ink',
    )
    for (const item of screen.getAllByRole('radio')) {
      expect(item.className).not.toMatch(/active:bg-/)
    }
  })

  it('appends the caller className to the track', () => {
    const { container } = render(
      <Segmented
        aria-label="보기 방식"
        className="mt-12"
        value="list"
        onValueChange={() => undefined}
      >
        <SegmentedItem value="list">목록</SegmentedItem>
      </Segmented>,
    )

    expect(container.firstElementChild).toHaveClass('mt-12', 'bg-control')
  })
})
