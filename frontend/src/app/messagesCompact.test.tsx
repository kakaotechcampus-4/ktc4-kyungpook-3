import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '@/shared/config/routes'
import { MOCK_NOW } from '@/shared/mock/fixtures/constants'
import { applyScenario } from '@/shared/mock/scenarios'
import { renderApp } from './test/renderApp'

/*
 * #478 H-4·H-5 — 폭 768px 미만 메시지 화면. 목록과 상세 중 하나만 화면 전체로 보이고, 상세는 셸 헤더·아래 탭 막대 대신
 * 뒤로 가기 머리를 둔다. 자리·높이·토스트 위치는 e2e/layout.e2e.ts 와 e2e/messages-toast.e2e.ts 가 본다
 */

vi.setConfig({ testTimeout: 15_000 })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(MOCK_NOW))
})
afterEach(() => {
  vi.useRealTimers()
})

/** 폭을 바꿀 수 있는 matchMedia. 셸과 메시지 화면은 `(max-width: 767.98px)` 하나만 묻는다 */
function stubViewportWidth(initial: number) {
  let width = initial
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = /max-width: ([\d.]+)px/.exec(query)
    return {
      get matches() {
        return max === null ? query === '(prefers-reduced-motion: reduce)' : width <= Number(max[1])
      },
      media: query,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }
  })
  return (next: number) => {
    width = next
    act(() => listeners.forEach((listener) => listener()))
  }
}

const inboxList = () => screen.queryByRole('complementary', { name: '메시지 목록' })
const detailArea = () => screen.queryByRole('region', { name: '메시지 내용' })
const tabBar = () => screen.queryByRole('navigation', { name: '주요 화면' })
const backLink = () => screen.getByRole('link', { name: '메시지 목록으로' })

it('목록에서 대화를 누르면 상세가 화면 전체로 열리고, 뒤로 가기는 기록 한 칸 뒤의 목록으로 돌아간다', async () => {
  stubViewportWidth(390)
  applyScenario('messages-member')
  const app = renderApp(paths.messages('ws_01'))
  const list = await screen.findByRole('complementary', { name: '메시지 목록' })
  const threads = await within(list).findByRole('region', { name: '대화' })
  // 넓은 화면처럼 첫 대화를 대신 고르지 않는다 — 상세는 숨어 있고 고른 행도 없다
  expect(detailArea()).toBeNull()
  expect(
    within(list)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page'),
  ).toEqual([])
  expect(tabBar()).not.toBeNull()

  const row = within(threads).getAllByRole('link')[0]
  await userEvent.click(row)
  await app.expectPath(row.getAttribute('href')!)
  expect(inboxList()).toBeNull()
  expect(await screen.findByRole('textbox', { name: '답장' })).toBeVisible()
  // 시안(PwaThreadMember)처럼 셸 헤더와 아래 탭 막대 대신 뒤로 가기·제목 머리다
  expect(tabBar()).toBeNull()
  expect(screen.queryByRole('banner')).toBeNull()
  expect(backLink()).toBeVisible()

  await userEvent.click(backLink())
  await app.expectPath(paths.messages('ws_01'))
  expect(app.visitedActions().at(-1)).toBe('POP')
  expect(await screen.findByRole('complementary', { name: '메시지 목록' })).toBeVisible()
  expect(tabBar()).not.toBeNull()
})

it('주소로 바로 연 대화의 뒤로 가기는 목록으로 바꿔 끼운다', async () => {
  stubViewportWidth(360)
  applyScenario('messages-member')
  const app = renderApp(paths.messageThread('ws_01', 'th_06'))
  await screen.findByRole('textbox', { name: '답장' })
  await userEvent.click(backLink())
  await app.expectPath(paths.messages('ws_01'))
  expect(app.visitedActions().at(-1)).toBe('REPLACE')
  expect(await screen.findByRole('complementary', { name: '메시지 목록' })).toBeVisible()
})

it('보내기 전 확인도 화면 전체로 열리고 머리에 받는 사람을 둔다', async () => {
  stubViewportWidth(390)
  renderApp(paths.messages('ws_01'))
  const list = await screen.findByRole('complementary', { name: '메시지 목록' })
  const reviews = await within(list).findByRole('region', { name: /^보내기 전 확인/ })
  const row = within(reviews).getAllByRole('link')[0]
  await userEvent.click(row)
  const review = await screen.findByRole('article')
  expect(inboxList()).toBeNull()
  const recipient = review.querySelector('strong')!
  const subtitle = screen.getByText('보내기 전 확인', { selector: 'p' })
  expect(subtitle.previousElementSibling).toHaveTextContent(recipient.textContent)
  expect(backLink()).toBeVisible()
})

it('768 경계를 넘나들어도 고른 대화와 쓰던 답장이 남는다', async () => {
  const resize = stubViewportWidth(390)
  applyScenario('messages-pm-self')
  renderApp(paths.messageThread('ws_01', 'th_06'))
  const field = await screen.findByRole('textbox', { name: '답장' })
  await userEvent.type(field, '쓰던 답장')

  resize(1024)
  expect(screen.getByRole('complementary', { name: '메시지 목록' })).toBeVisible()
  expect(screen.getByRole('textbox', { name: '답장' })).toBe(field)
  expect(field).toHaveValue('쓰던 답장')
  expect(tabBar()).not.toBeNull()

  resize(390)
  expect(inboxList()).toBeNull()
  expect(screen.getByRole('textbox', { name: '답장' })).toBe(field)
  expect(field).toHaveValue('쓰던 답장')
  expect(backLink()).toBeVisible()
})

it('휴대폰 목록의 기본 대화에서 쓰던 답장을 이탈 확인에서 버리면 실제로 사라지고 다시 묻지 않는다', async () => {
  stubViewportWidth(390)
  applyScenario('messages-member')
  // 팀원의 첫 대화는 넓은 화면이 목록 주소에서 대신 고르는 대화다 — 목록으로 돌아가도 같은 상세가 숨어 남던 곳이다
  const app = renderApp(paths.messageThread('ws_01', 'th_06'))
  await userEvent.type(await screen.findByRole('textbox', { name: '답장' }), '버릴 답장')

  await userEvent.click(backLink())
  const prompt = await screen.findByRole('dialog')
  await userEvent.click(within(prompt).getByRole('button', { name: '변경 내용 버리고 나가기' }))
  await app.expectPath(paths.messages('ws_01'))
  expect(screen.queryByRole('textbox', { name: '답장', hidden: true })).toBeNull()

  const threads = await within(
    await screen.findByRole('complementary', { name: '메시지 목록' }),
  ).findByRole('region', { name: '대화' })
  await userEvent.click(within(threads).getAllByRole('link')[0])
  await app.expectPath(paths.messageThread('ws_01', 'th_06'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(await screen.findByRole('textbox', { name: '답장' })).toHaveValue('')
})

it('넓은 화면 두 단에서 고른 대화는 휴대폰 폭에서 뒤로 가기가 이전 상세가 아니라 목록으로 간다', async () => {
  const resize = stubViewportWidth(1024)
  applyScenario('messages-pm-self')
  const app = renderApp(paths.messageThread('ws_01', 'th_01'))
  const threads = await within(
    await screen.findByRole('complementary', { name: '메시지 목록' }),
  ).findByRole('region', { name: '대화' })
  const other = within(threads)
    .getAllByRole('link')
    .find((link) => link.getAttribute('aria-current') !== 'page')!
  await userEvent.click(other)
  await app.expectPath(other.getAttribute('href')!)

  resize(390)
  await userEvent.click(backLink())
  await app.expectPath(paths.messages('ws_01'))
  expect(app.visitedActions().at(-1)).toBe('REPLACE')
})

it('목록에서 상세로 들어가면 상세 머리 제목에, 돌아오면 누른 행에 포커스가 간다', async () => {
  stubViewportWidth(390)
  applyScenario('messages-member')
  const app = renderApp(paths.messages('ws_01'))
  const threads = await within(
    await screen.findByRole('complementary', { name: '메시지 목록' }),
  ).findByRole('region', { name: '대화' })
  const row = within(threads).getAllByRole('link')[0]
  const rowPath = row.getAttribute('href')!
  await userEvent.click(row)
  await app.expectPath(rowPath)
  // 상세 머리(DetailBar)의 제목이다. jsdom 은 CSS 가 없어 768 이상 머리(max-md:hidden)도 남아 있어 속성으로 고른다
  expect(document.activeElement?.tagName).toBe('H2')
  expect(document.activeElement).toHaveAttribute('tabindex', '-1')

  await userEvent.click(backLink())
  await app.expectPath(paths.messages('ws_01'))
  const list = await screen.findByRole('complementary', { name: '메시지 목록' })
  const again = within(list)
    .getAllByRole('link')
    .find((link) => link.getAttribute('href') === rowPath)
  expect(document.activeElement).toBe(again)
})

it('답장 근거로 연 대화에서 목록으로 돌아오면 그 대화 행에 포커스가 간다', async () => {
  stubViewportWidth(390)
  applyScenario('messages-merge')
  const app = renderApp(paths.messageReview('ws_01', 'bd_07'))
  await userEvent.click(await screen.findByRole('link', { name: "'ERD 정리' 답장 보기" }))
  await app.expectSearch('?message=mg_02')
  await screen.findByRole('region', { name: '대화 내용' })

  await userEvent.click(backLink())
  await app.expectPath(paths.messages('ws_01'))
  const list = await screen.findByRole('complementary', { name: '메시지 목록' })
  const row = within(within(list).getByRole('region', { name: '대화' }))
    .getAllByRole('link')
    .find((link) => link.getAttribute('href') === paths.messageThread('ws_01', 'th_01'))
  expect(row).toBeDefined()
  expect(document.activeElement).toBe(row)
})

it('가상 키보드가 보이는 영역을 줄이면 화면 전체 상세를 그 영역에 맞춘다', async () => {
  stubViewportWidth(390)
  const listeners = new Set<() => void>()
  const viewport = {
    height: window.innerHeight,
    offsetTop: 0,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }
  vi.stubGlobal('visualViewport', viewport)
  applyScenario('messages-member')
  renderApp(paths.messageThread('ws_01', 'th_06'))
  await screen.findByRole('textbox', { name: '답장' })
  const main = screen.getByRole('region', { name: '메시지 내용' }).closest('main')!
  expect(main.style.position).toBe('')

  viewport.height = 400
  viewport.offsetTop = 120
  act(() => listeners.forEach((listener) => listener()))
  expect(main.style).toMatchObject({ position: 'fixed', top: '120px', height: '400px' })

  viewport.height = window.innerHeight
  viewport.offsetTop = 0
  act(() => listeners.forEach((listener) => listener()))
  expect(main.style.position).toBe('')
})
