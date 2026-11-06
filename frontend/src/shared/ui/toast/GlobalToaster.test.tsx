import { act, render, screen } from '@testing-library/react'
import { GlobalToaster } from './GlobalToaster'
import { PinnedToast } from './PinnedToast'
import { toast } from './toastStore'

function visibleKeys(): (string | undefined)[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-toast-key]'),
    (node) => node.dataset.toastKey,
  )
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('GlobalToaster', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('기본 5초 동안 보인다', () => {
    render(<GlobalToaster />)
    act(() => toast.show({ key: 'saved', title: '저장했어요' }))
    advance(4999)
    expect(visibleKeys()).toEqual(['saved'])
    advance(2)
    expect(visibleKeys()).toEqual([])
  })

  it('액션이 있으면 10초 동안 보인다', () => {
    render(<GlobalToaster />)
    act(() =>
      toast.show({
        key: 'archived',
        title: '보관했어요',
        action: { label: '되돌리기', onClick: vi.fn() },
      }),
    )
    advance(9999)
    expect(visibleKeys()).toEqual(['archived'])
    advance(2)
    expect(visibleKeys()).toEqual([])
  })

  it('같은 key 는 하나만 그리고, 다시 띄우면 시간이 처음부터 흐른다', () => {
    render(<GlobalToaster />)
    act(() => toast.show({ key: 'saved', title: '저장했어요' }))
    advance(3000)
    act(() => toast.show({ key: 'saved', title: '저장했어요' }))
    expect(visibleKeys()).toEqual(['saved'])
    advance(3000)
    expect(visibleKeys()).toEqual(['saved'])
    advance(2001)
    expect(visibleKeys()).toEqual([])
  })

  it('동시에 3개까지만 그린다', () => {
    render(<GlobalToaster />)
    act(() => {
      for (const key of ['a', 'b', 'c', 'd']) toast.show({ key, title: key })
    })
    expect(visibleKeys()).toEqual(['b', 'c', 'd'])
  })

  it('오른쪽 아래 24px 에 고정하고 그림자·전환이 없다', () => {
    render(<GlobalToaster />)
    const dock = screen.getByTestId('toast-dock')
    expect(dock).toHaveClass('fixed', 'right-24', 'bottom-24', 'z-100', 'flex', 'flex-col', 'gap-8')
    expect(dock.className).not.toMatch(/shadow|transition|animate/)
  })

  it('고정 토스트는 독 안에서 짧은 토스트 목록 아래에 그린다', () => {
    render(
      <>
        <GlobalToaster />
        <PinnedToast>
          <p>정리 중</p>
        </PinnedToast>
      </>,
    )
    act(() => toast.show({ key: 'saved', title: '저장했어요' }))
    const dock = screen.getByTestId('toast-dock')
    const pinned = screen.getByText('정리 중')
    const saved = screen.getByText('저장했어요')
    expect(dock).toContainElement(pinned)
    expect(dock).toContainElement(saved)
    expect(saved.compareDocumentPosition(pinned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('토스트 자리가 없으면 고정 토스트도 그리지 않는다', () => {
    render(
      <PinnedToast>
        <p>정리 중</p>
      </PinnedToast>,
    )
    expect(screen.queryByText('정리 중')).toBeNull()
  })
})
