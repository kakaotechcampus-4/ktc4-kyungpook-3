import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MinutesTitle } from './MinutesTitle'

/*
 * 회의록 제목 — 늘 한 줄, 넘치면 말줄임, 잘렸을 때만 전체 제목을 툴팁으로 (UX1-M04, 사용자 결정).
 * jsdom 은 배치를 하지 않아 폭이 모두 0 이다. 제목 칸의 글 폭(scrollWidth)과 보이는 폭(clientWidth)을 정해 준다 —
 * 실제 폭의 말줄임 · 한 줄 높이 · 마우스 · 키보드는 e2e/meeting-skeleton.e2e.ts 가 Chromium 에서 본다.
 */
const LONG = '2026년 10월 서비스 출시 계획과 개발 일정 및 사용자 피드백을 함께 논의하는 정기 회의'

function sizeHeading({ scroll, client }: { scroll: number; client: number }) {
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'H2' ? scroll : 0
  })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'H2' ? client : 0
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MinutesTitle — 한 줄 제목과 말줄임 (UX1-M04)', () => {
  it('제목은 한 줄 높이(1lh)로 고정하고 넘치면 말줄임이다 — 스크린리더의 heading 이름은 전체 제목이다', () => {
    sizeHeading({ scroll: 900, client: 600 })
    render(<MinutesTitle title={LONG} />)
    const heading = screen.getByRole('heading', { level: 2, name: LONG })
    expect(heading).toHaveClass('h-lh', 'truncate')
    // 툴팁은 같은 제목을 다시 보이는 것이라 설명으로 잇지 않는다 — 두 번 읽히지 않는다
    expect(heading).not.toHaveAttribute('aria-describedby')
  })

  it('잘렸으면 키보드로 제목에 가서 전체 제목을 본다 — Esc 로 닫힌다', async () => {
    sizeHeading({ scroll: 900, client: 600 })
    const user = userEvent.setup()
    render(<MinutesTitle title={LONG} />)
    const heading = screen.getByRole('heading', { level: 2, name: LONG })
    expect(heading).toHaveAttribute('tabindex', '0')

    await user.tab()
    expect(heading).toHaveFocus()
    expect(await screen.findByTestId('minutes-title-tooltip')).toHaveTextContent(LONG)
    expect(heading).not.toHaveAttribute('aria-describedby')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('minutes-title-tooltip')).toBeNull())
    expect(heading).toHaveFocus()
  })

  it('잘렸으면 가리킬 때 전체 제목이 뜬다', async () => {
    sizeHeading({ scroll: 900, client: 600 })
    const user = userEvent.setup()
    render(<MinutesTitle title={LONG} />)

    await user.hover(screen.getByRole('heading', { level: 2, name: LONG }))
    expect(await screen.findByTestId('minutes-title-tooltip')).toHaveTextContent(LONG)
  })

  it('다 보이면 Tab 자리도 툴팁도 없다', () => {
    sizeHeading({ scroll: 300, client: 600 })
    render(<MinutesTitle title="3주차 정기회의" />)
    const heading = screen.getByRole('heading', { level: 2, name: '3주차 정기회의' })
    expect(heading).not.toHaveAttribute('tabindex')

    // Radix 는 포커스에 지연 없이 연다 — 그래도 열리지 않는다. 막은 것은 지연이 아니라 잘리지 않음이다
    fireEvent.focus(heading)
    expect(screen.queryByTestId('minutes-title-tooltip')).toBeNull()
  })
})
