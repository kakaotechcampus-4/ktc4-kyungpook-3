import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { Toast, ToastProvider, ToastViewport } from './Toast'

/** Provider 는 **테스트가** 씌운다. M2 의 app/ 은 이것을 올리지 않는다 */
function renderInProvider(node: ReactNode) {
  return render(
    <ToastProvider>
      {node}
      <ToastViewport />
    </ToastProvider>,
  )
}

function root() {
  return screen.getByTestId('toast')
}

describe('Toast', () => {
  it('draws the title and the description the caller gave', () => {
    renderInProvider(
      <Toast data-testid="toast" title="정리가 끝났습니다" description="3건을 옮겼습니다" />,
    )

    expect(within(root()).getByText('정리가 끝났습니다')).toHaveClass(
      'text-body',
      'font-semibold',
      'text-ink',
    )
    expect(within(root()).getByText('3건을 옮겼습니다')).toHaveClass('text-caption', 'text-dim')
  })

  it('leaves the description out when none is given', () => {
    renderInProvider(<Toast data-testid="toast" title="정리가 끝났습니다" />)

    expect(within(root()).queryByText('3건을 옮겼습니다')).toBeNull()
    expect(root().children).toHaveLength(1)
  })

  it('draws the surface with the proposed card values', () => {
    renderInProvider(<Toast data-testid="toast" title="정리가 끝났습니다" />)

    expect(root()).toHaveClass(
      'min-w-[280px]',
      'max-w-[380px]',
      'bg-surface',
      'border',
      'border-line',
      'rounded-12',
      'px-16',
      'py-14',
    )
  })

  it('carries no shadow anywhere — the hairline does the work', () => {
    renderInProvider(<Toast data-testid="toast" title="정리가 끝났습니다" />)
    const viewport = root().parentElement

    for (const node of [viewport, root()]) {
      const names = node?.className.split(' ') ?? []
      expect(names.filter((name) => name.includes('shadow'))).toEqual([])
    }
  })

  it('carries no transition and no animation, so reduced motion gets it for free', () => {
    renderInProvider(<Toast data-testid="toast" title="정리가 끝났습니다" />)

    const names = root().className.split(' ')
    expect(names.filter((name) => name.includes('transition'))).toEqual([])
    expect(names.filter((name) => name.includes('animate'))).toEqual([])
  })

  it('has no error tone — errors do not go through a toast', () => {
    renderInProvider(<Toast data-testid="toast" title="정리가 끝났습니다" />)

    expect(root().className).not.toMatch(/accent/)
    expect(root()).not.toHaveAttribute('data-variant')
  })

  it('pins the viewport to the bottom right', () => {
    renderInProvider(<Toast data-testid="toast" title="정리가 끝났습니다" />)

    expect(root().parentElement).toHaveClass(
      'fixed',
      'bottom-24',
      'right-24',
      'flex',
      'flex-col',
      'gap-8',
      'z-100',
    )
  })

  it('appends the caller className to the root and to the viewport', () => {
    render(
      <ToastProvider>
        <Toast data-testid="toast" title="정리가 끝났습니다" className="max-w-full" />
        <ToastViewport className="bottom-48" />
      </ToastProvider>,
    )

    expect(root()).toHaveClass('rounded-12', 'max-w-full')
    expect(root().parentElement).toHaveClass('fixed', 'bottom-48')
  })

  /* 클릭은 `fireEvent` 로 낸다. `userEvent` 는 pointerdown 까지 내는데
     Radix 의 스와이프 핸들러가 거기서 `hasPointerCapture` 를 부르고, jsdom 에 그 메서드가 없다. */
  it('labels the action with the caller string and runs its handler', () => {
    const onClick = vi.fn()
    renderInProvider(
      <Toast
        data-testid="toast"
        title="작업을 보관했습니다"
        action={{ label: '되돌리기', onClick }}
      />,
    )

    fireEvent.click(within(root()).getByRole('button', { name: '되돌리기' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('closes when the action is pressed — the action doubles as the close', () => {
    const onOpenChange = vi.fn()
    renderInProvider(
      <Toast
        data-testid="toast"
        title="작업을 보관했습니다"
        onOpenChange={onOpenChange}
        action={{ label: '되돌리기', onClick: vi.fn() }}
      />,
    )

    fireEvent.click(within(root()).getByRole('button', { name: '되돌리기' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('draws no dismiss control when there is no action', () => {
    renderInProvider(<Toast data-testid="toast" title="정리가 끝났습니다" />)

    expect(within(root()).queryAllByRole('button')).toHaveLength(0)
  })

  describe('duration', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('stays for 6 seconds when there is nothing to undo', () => {
      const onOpenChange = vi.fn()
      renderInProvider(
        <Toast data-testid="toast" title="정리가 끝났습니다" onOpenChange={onOpenChange} />,
      )

      act(() => {
        vi.advanceTimersByTime(5999)
      })
      expect(onOpenChange).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(2)
      })
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('stays for 10 seconds when an action has to be reachable', () => {
      const onOpenChange = vi.fn()
      renderInProvider(
        <Toast
          data-testid="toast"
          title="작업을 보관했습니다"
          onOpenChange={onOpenChange}
          action={{ label: '되돌리기', onClick: vi.fn() }}
        />,
      )

      act(() => {
        vi.advanceTimersByTime(6001)
      })
      expect(onOpenChange).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(4000)
      })
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('lets the caller override the duration', () => {
      const onOpenChange = vi.fn()
      renderInProvider(
        <Toast
          data-testid="toast"
          title="정리가 끝났습니다"
          duration={2000}
          onOpenChange={onOpenChange}
        />,
      )

      act(() => {
        vi.advanceTimersByTime(2001)
      })
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('mounts no Provider of its own — the caller supplies one', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Toast title="정리가 끝났습니다" />)).toThrow(/must be used within/)

    logged.mockRestore()
  })
})
