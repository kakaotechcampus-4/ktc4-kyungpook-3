import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MinutesAttendee } from '@/entities/minutes'
import { AttendeeRow } from './AttendeeRow'

/*
 * jsdom 은 배치를 하지 않아 폭이 모두 0 이다. 재는 칸의 칩은 이름 글자 수로, 참석자 줄은 정한 폭으로 돌려준다 —
 * 실제 폭의 줄 높이·`+N` 은 e2e/meeting-skeleton.e2e.ts 가 1024·1440·1920px 에서 잰다.
 */
const ROW_WIDTH = 200
/** 지금 참석자 줄 폭 — 창 크기 바꾸기 검사가 바꾼다 */
let rowWidth = ROW_WIDTH
const LETTER = 10
const PADDING = 16

function attendees(count: number): MinutesAttendee[] {
  return Array.from({ length: count }, (_, index) => ({
    memberId: `mb_${index}`,
    // 4글자 — 칩 폭 56
    displayName: `팀원${String(index + 1).padStart(2, '0')}`,
  }))
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const label = this.getAttribute('data-label')
    const width =
      label !== null
        ? label.length * LETTER + PADDING
        : this.firstElementChild?.getAttribute('aria-label') === '참석자'
          ? rowWidth
          : 0
    return DOMRect.fromRect({ width, height: 22 })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  rowWidth = ROW_WIDTH
})

function shownNames() {
  return within(screen.getByRole('list', { name: '참석자' }))
    .getAllByRole('listitem')
    .filter((item) => !item.classList.contains('sr-only'))
    .map((item) => item.textContent)
}

describe('AttendeeRow — 참석자 줄 한 줄 + `+N` (UX1-M03)', () => {
  it('한 줄에 들어가면 이름 칩을 모두 보이고 `+N` 이 없다', () => {
    // 56 × 3 = 168 ≤ 200 (jsdom 은 간격이 0 이다)
    render(<AttendeeRow attendees={attendees(3)} />)
    expect(shownNames()).toEqual(['팀원01', '팀원02', '팀원03'])
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('넘치면 들어가는 만큼만 보이고 남는 사람은 `+N` — 스크린리더에는 `참석자` 목록이 늘 전체다', () => {
    // `+10` 칩 46. 56 × 2 + 46 = 158 ≤ 200, 56 × 3 + 46 = 214 > 200
    render(<AttendeeRow attendees={attendees(10)} />)
    expect(shownNames()).toEqual(['팀원01', '팀원02'])
    expect(
      within(screen.getByRole('list', { name: '참석자' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(attendees(10).map(({ displayName }) => displayName))
    expect(screen.getByRole('button', { name: '+8, 참석자 10명 모두 보기' })).toHaveTextContent(
      '+8',
    )
    // 재는 칸은 읽히지 않고 화면 글자도 없다 — 이름이 두 번 나오지 않는다
    expect(screen.getAllByText('팀원01')).toHaveLength(1)
    expect(screen.getByTestId('attendee-measure').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('`+N` 은 키보드로 열고 Esc 로 닫는다 — 전체 참석자가 보이고 닫히면 `+N` 으로 포커스가 돌아온다', async () => {
    const user = userEvent.setup()
    render(<AttendeeRow attendees={attendees(10)} />)
    const more = screen.getByRole('button', { name: /^\+8, / })
    expect(more).toHaveAttribute('aria-expanded', 'false')

    await user.tab()
    expect(more).toHaveFocus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: '참석자 10명' })
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(
      within(dialog)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(attendees(10).map(({ displayName }) => displayName))
    // 포커스가 팝오버 안으로 옮겨 간다
    expect(dialog.contains(document.activeElement)).toBe(true)

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(more).toHaveFocus()

    // Space 로도 열고, 다시 누르면 닫힌다
    await user.keyboard(' ')
    expect(await screen.findByRole('dialog', { name: '참석자 10명' })).toBeInTheDocument()
    await user.click(more)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('20명이면 `+N` 의 N 도 남는 사람 수다', () => {
    // `+20` 칩 46 — 10명과 같은 폭이라 보이는 칩도 둘이다
    render(<AttendeeRow attendees={attendees(20)} />)
    expect(shownNames()).toHaveLength(2)
    expect(screen.getByRole('button', { name: '+18, 참석자 20명 모두 보기' })).toBeInTheDocument()
  })

  it('줄 폭이 바뀌면(ResizeObserver) 다음 렌더를 기다리지 않고 그 콜백 안에서 칩 수 · `+N` 이 바뀐다 (UX1-N02)', () => {
    // ResizeObserver 콜백은 배치 뒤 · 그리기 전에 돈다. 콜백이 돌아온 순간의 DOM 이 그 프레임에 그려지는 모습이다
    const callbacks: ResizeObserverCallback[] = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback)
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    render(<AttendeeRow attendees={attendees(10)} />)
    expect(shownNames()).toHaveLength(2)
    expect(callbacks).toHaveLength(1)

    // 창을 넓힌다 — 56 × 6 + 46 = 382 ≤ 400, 56 × 7 + 46 = 438 > 400.
    // act 밖에서 부른다 — act 는 끝날 때 밀린 렌더를 모두 비워 "다음 렌더에 반영"과 "그 자리에서 반영"을 가르지 못한다
    rowWidth = 400
    const actEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
    try {
      callbacks[0]([], {} as ResizeObserver)
      expect(shownNames()).toHaveLength(6)
      expect(screen.getByRole('button', { name: '+4, 참석자 10명 모두 보기' })).toBeInTheDocument()

      // 다시 좁힌다 — 잘린 칩 · 낡은 `+N` 이 남는 순간이 없다
      rowWidth = ROW_WIDTH
      callbacks[0]([], {} as ResizeObserver)
      expect(shownNames()).toHaveLength(2)
      expect(screen.getByRole('button', { name: '+8, 참석자 10명 모두 보기' })).toBeInTheDocument()
    } finally {
      ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
        actEnvironment
    }
  })
})
