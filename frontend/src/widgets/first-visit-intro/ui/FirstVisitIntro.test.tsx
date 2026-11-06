import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FirstVisitIntro } from './FirstVisitIntro'

const FIRST = '안녕하세요, 저는 매스예요.'
const SECOND = '회의를 올려 주시면 결정사항과 할 일을 정리해 드릴게요.'
const THIRD = '확인이 필요한 것만 골라서 물어볼게요.'

const bubble = () => screen.getByText(/매스예요|정리해 드릴게요|물어볼게요/)

function allowMotion() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }))
}

afterEach(() => vi.useRealTimers())

describe('첫 방문 인트로 (#430)', () => {
  it('화면 전체 대화상자에 매스의 첫 말, 건너뛰기, 시작하기, 점 세 개가 있다', () => {
    render(<FirstVisitIntro open onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: '매스 소개' })).toBeInTheDocument()
    expect(bubble()).toHaveTextContent(FIRST)
    expect(bubble()).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('button', { name: '건너뛰기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '시작하기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1번째 말' })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: '2번째 말' })).not.toHaveAttribute('aria-current')
  })

  it('닫혀 있으면 아무것도 그리지 않는다', () => {
    render(<FirstVisitIntro open={false} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('2.6초마다 다음 말로 넘어가고 마지막 말에서 멈춘다', async () => {
    vi.useFakeTimers()
    render(<FirstVisitIntro open onClose={vi.fn()} />)

    await act(() => vi.advanceTimersByTimeAsync(2599))
    expect(bubble()).toHaveTextContent(FIRST)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(bubble()).toHaveTextContent(SECOND)
    await act(() => vi.advanceTimersByTimeAsync(2600))
    expect(bubble()).toHaveTextContent(THIRD)
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(bubble()).toHaveTextContent(THIRD)
    expect(screen.getByRole('button', { name: '3번째 말' })).toHaveAttribute('aria-current', 'step')
  })

  it('점을 누르면 그 말로 가고, 거기서부터 다시 센다', async () => {
    vi.useFakeTimers()
    render(<FirstVisitIntro open onClose={vi.fn()} />)

    await act(() => vi.advanceTimersByTimeAsync(5200))
    fireEvent.click(screen.getByRole('button', { name: '1번째 말' }))
    expect(bubble()).toHaveTextContent(FIRST)
    expect(screen.getByRole('button', { name: '1번째 말' })).toHaveAttribute('aria-current', 'step')

    await act(() => vi.advanceTimersByTimeAsync(2600))
    expect(bubble()).toHaveTextContent(SECOND)
  })

  it('움직임 줄이기면 말이 바로 바뀐다', () => {
    vi.useFakeTimers()
    render(<FirstVisitIntro open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '3번째 말' }))
    expect(bubble()).toHaveTextContent(THIRD)
    expect(bubble()).not.toHaveClass('opacity-0')
  })

  it('움직임을 허용하면 0.22초 흐려진 뒤 말이 바뀐다', async () => {
    allowMotion()
    vi.useFakeTimers()
    render(<FirstVisitIntro open onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '3번째 말' }))
    expect(bubble()).toHaveTextContent(FIRST)
    expect(bubble()).toHaveClass('opacity-0')
    expect(screen.getByRole('button', { name: '3번째 말' })).toHaveAttribute('aria-current', 'step')

    await act(() => vi.advanceTimersByTimeAsync(220))
    expect(bubble()).toHaveTextContent(THIRD)
    expect(bubble()).not.toHaveClass('opacity-0')
  })

  it.each(['건너뛰기', '시작하기'])('`%s` 는 닫는다', async (name) => {
    const onClose = vi.fn()
    render(<FirstVisitIntro open onClose={onClose} />)
    await userEvent.click(screen.getByRole('button', { name }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc 는 건너뛰기와 같다', async () => {
    const onClose = vi.fn()
    render(<FirstVisitIntro open onClose={onClose} />)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('점은 Tab 으로 닿는 버튼이다', async () => {
    render(<FirstVisitIntro open onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: '건너뛰기' })).toHaveFocus()
    await userEvent.tab()
    expect(screen.getByRole('button', { name: '1번째 말' })).toHaveFocus()
    await userEvent.keyboard('{Tab}{Enter}')
    expect(bubble()).toHaveTextContent(SECOND)
  })
})
