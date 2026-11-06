import { act, render, screen } from '@testing-library/react'
import { onTestFinished } from 'vitest'
import { GlobalToaster } from './GlobalToaster'
import { PinnedToast } from './PinnedToast'
import { PinnedToastHost } from './PinnedToastHost'
import { usePinnedToastReserve } from './pinnedSlot'

function stubResizeObserver(): () => void {
  const callbacks: (() => void)[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        callbacks.push(callback)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  return () => {
    act(() => {
      for (const callback of callbacks) callback()
    })
  }
}

function Reserve() {
  return <output aria-label="본문 아래 여백">{usePinnedToastReserve()}</output>
}

function Screen({ hosts = [0] }: { hosts?: number[] }) {
  return (
    <>
      <GlobalToaster />
      {hosts.map((id) => (
        <div key={id} data-testid={`area-${id}`}>
          <PinnedToastHost />
        </div>
      ))}
      <PinnedToast>
        <p>정리 중</p>
      </PinnedToast>
      <Reserve />
    </>
  )
}

describe('PinnedToastHost', () => {
  it('화면이 자리를 두면 고정 토스트는 독이 아니라 그 자리에 그린다', () => {
    render(<Screen />)
    expect(screen.getByTestId('area-0')).toContainElement(screen.getByText('정리 중'))
    expect(screen.getByTestId('pinned-toast-slot')).toBeEmptyDOMElement()
  })

  it('자리가 없거나 내려가면 고정 토스트는 독에 그린다', () => {
    const { rerender } = render(<Screen />)
    rerender(<Screen hosts={[]} />)
    expect(screen.getByTestId('pinned-toast-slot')).toContainElement(screen.getByText('정리 중'))
  })

  it('먼저 올라온 자리가 내려가도 나중 자리는 그대로 토스트를 받는다', () => {
    const { rerender } = render(<Screen hosts={[0, 1]} />)
    expect(screen.getByTestId('area-1')).toContainElement(screen.getByText('정리 중'))
    rerender(<Screen hosts={[1]} />)
    expect(screen.getByTestId('area-1')).toContainElement(screen.getByText('정리 중'))
  })

  it('토스트가 자리로 옮겨 가면 독 칸이 비어 셸의 본문 아래 여백이 0 이 된다', () => {
    const resized = stubResizeObserver()
    const { rerender } = render(<Screen hosts={[]} />)
    const slot = screen.getByTestId('pinned-toast-slot')
    vi.spyOn(slot, 'getBoundingClientRect').mockImplementation(
      () => ({ height: slot.childElementCount > 0 ? 120 : 0 }) as DOMRect,
    )
    resized()
    expect(screen.getByRole('status', { name: '본문 아래 여백' })).toHaveTextContent('144')

    rerender(<Screen />)
    resized()
    expect(slot).toBeEmptyDOMElement()
    expect(screen.getByRole('status', { name: '본문 아래 여백' })).toHaveTextContent('0')
  })

  it('자기 높이를 알리고, 빈 자리는 누름을 통과시킨다', () => {
    const resized = stubResizeObserver()
    const onHeightChange = vi.fn()
    render(
      <>
        <GlobalToaster />
        <PinnedToastHost onHeightChange={onHeightChange} />
        <PinnedToast>
          <p>정리 중</p>
        </PinnedToast>
      </>,
    )
    const host = screen.getByText('정리 중').parentElement as HTMLElement
    expect(host).toHaveClass('pointer-events-none', 'empty:hidden')
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue({ height: 40.5 } as DOMRect)
    resized()
    expect(onHeightChange).toHaveBeenLastCalledWith(40.5)
  })
})
