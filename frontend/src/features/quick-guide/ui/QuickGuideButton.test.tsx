import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import { QuickGuideButton } from './QuickGuideButton'

const GUIDE_URL =
  'https://github.com/kakaotechcampus-4/ktc4-kyungpook-3/blob/develop/docs/user/getting-started.md'

/** 셸과 같은 질의 `(max-width: 767.98px)` 에 폭으로 답한다 */
function stubViewportWidth(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = /max-width: ([\d.]+)px/.exec(query)
    return {
      matches: max === null ? false : width <= Number(max[1]),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }
  })
}

async function openGuide() {
  const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
  render(
    <>
      <button type="button">앞 단추</button>
      <QuickGuideButton aria-label="도움말">?</QuickGuideButton>
    </>,
  )
  const opener = screen.getByRole('button', { name: '도움말' })
  await user.click(opener)
  const panel = await screen.findByRole('dialog', { name: '처음 쓰는 분을 위한 안내' })
  return { user, opener, panel }
}

type User = ReturnType<typeof userEvent.setup>

const closeByButton = (user: User, panel: HTMLElement) =>
  user.click(within(panel).getByRole('button', { name: '닫기' }))
const closeByEscape = (user: User) => user.keyboard('{Escape}')
/** 시트만 손잡이·제목 자리를 끌어 내려 닫는다 */
const closeByDrag = (_: User, panel: HTMLElement) => {
  const grip = within(panel).getByRole('heading', { level: 2 }).parentElement as HTMLElement
  fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientY: 400 })
  fireEvent.pointerMove(grip, { pointerId: 1, clientY: 520 })
  fireEvent.pointerUp(grip, { pointerId: 1, clientY: 520 })
  return Promise.resolve()
}

describe('처음 쓰는 분을 위한 안내 (#650)', () => {
  it('단추는 대화상자를 연다고 알리고, 누르기 전에는 패널이 없다', () => {
    render(<QuickGuideButton aria-label="도움말">?</QuickGuideButton>)
    const opener = screen.getByRole('button', { name: '도움말' })
    expect(opener).toHaveAttribute('aria-haspopup', 'dialog')
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('다섯 단계와 팀원이 할 일, 슬래시 명령을 원고대로 보인다', async () => {
    const { opener, panel } = await openGuide()
    expect(opener).toHaveAttribute('aria-expanded', 'true')
    expect(within(panel).getByText(/회의는 웹이 아니라/)).toHaveTextContent(
      '회의는 웹이 아니라 Discord 음성 채널에서 기록해요. 웹은 정리된 결과를 보고 승인하는 곳이에요.',
    )

    const steps = within(panel).getAllByRole('heading', { level: 3 })
    expect(steps.map((heading) => heading.textContent)).toEqual([
      'Discord 서버 준비',
      '팀원 초대',
      'Discord 연결과 팀원 연결',
      '회의 기록',
      '결과 확인',
    ])
    // 원고에서 4단계(회의 기록)만 팀원 줄이 없다
    const memberLines = steps.map((heading) =>
      heading.closest('li')?.textContent?.includes('팀원은:'),
    )
    expect(memberLines).toEqual([true, true, true, false, true])

    const commands = Array.from(panel.querySelectorAll('code')).map((code) => code.textContent)
    expect(commands).toEqual(['/join', '/record', '/stop'])

    const legend = within(panel).getByRole('table')
    expect(
      within(legend)
        .getAllByRole('rowheader')
        .map((cell) => cell.textContent),
    ).toEqual(['반영된 것', '확인 필요', '보류'])
  })

  it('바깥 문서는 새 탭으로 열고 그 사실을 이름에 싣는다', async () => {
    const { panel } = await openGuide()
    const links = within(panel).getAllByRole('link')
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['서버 만들기(새 탭)', 'https://support.discord.com/hc/ko/articles/204849977'],
      ['초대 링크(새 탭)', 'https://support.discord.com/hc/ko/articles/208866998'],
      ['자세히 보기 → 사용자 가이드(새 탭)', GUIDE_URL],
    ])
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noreferrer')
    }
  })

  it.each([
    ['닫기', closeByButton],
    ['Esc', closeByEscape],
  ] as const)(
    '넓은 화면은 모달이고, %s 로 닫으면 연 단추로 포커스가 돌아온다',
    async (_, close) => {
      const { user, opener, panel } = await openGuide()
      await waitFor(() => expect(panel).toContainElement(document.activeElement as HTMLElement))
      await close(user, panel)
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await waitFor(() => expect(opener).toHaveFocus())
      expect(opener).toHaveAttribute('aria-expanded', 'false')
    },
  )

  it.each([
    ['닫기', closeByButton],
    ['Esc', closeByEscape],
    ['끌어 내리기', closeByDrag],
  ] as const)(
    '휴대폰 폭은 시트이고, %s 로 닫으면 연 단추로 포커스가 돌아온다',
    async (_, close) => {
      stubViewportWidth(390)
      const { user, opener, panel } = await openGuide()
      expect(within(panel).getAllByRole('heading', { level: 3 })).toHaveLength(5)
      await waitFor(() => expect(panel).toContainElement(document.activeElement as HTMLElement))
      await close(user, panel)
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await waitFor(() => expect(opener).toHaveFocus())
    },
  )
})
