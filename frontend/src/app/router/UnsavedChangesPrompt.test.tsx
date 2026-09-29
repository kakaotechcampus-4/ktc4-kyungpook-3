import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { BrowserRouter, MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router'
import { GuardedLink, useGuardedNavigate, useUnsavedChanges } from '@/shared/lib/unsaved-changes'
import { UnsavedChangesPrompt } from './UnsavedChangesPrompt'

function Shell() {
  return (
    <>
      <Outlet />
      <UnsavedChangesPrompt />
    </>
  )
}

/** 저장하면 등록을 풀고 곧바로 다른 화면으로 간다 — 같은 이벤트 안의 코드 이동이다 */
function Draft({ name }: { name: string }) {
  const [value, setValue] = useState('')
  const navigate = useGuardedNavigate()
  const { release } = useUnsavedChanges(value !== '')

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        release()
        setValue('')
        navigate('/other')
      }}
    >
      <label>
        {name}
        <input value={value} onChange={(event) => setValue(event.target.value)} />
      </label>
      <button type="submit">{name} 저장</button>
      <button type="button" onClick={() => setValue('')}>
        {name} 초기화
      </button>
      <button type="button" onClick={() => navigate('/other')}>
        {name} 코드로 이동
      </button>
      <GuardedLink to="/other">{name} 다른 화면으로</GuardedLink>
      <GuardedLink to="?tab=2">{name} 탭 바꾸기</GuardedLink>
    </form>
  )
}

/** 선언형 라우터에는 밖에서 읽을 라우터 객체가 없다. 지금 주소는 화면에 적어 읽는다 */
function CurrentPath() {
  const { pathname, search } = useLocation()
  return <output data-testid="current-path">{pathname + search}</output>
}

const flow = (
  <Route element={<Shell />}>
    <Route path="/start" element={<p>시작 화면</p>} />
    <Route path="/form" element={<Draft name="메모" />} />
    <Route
      path="/two-forms"
      element={
        <>
          <Draft name="메모" />
          <Draft name="제목" />
        </>
      }
    />
    <Route path="/other" element={<p>다른 화면</p>} />
  </Route>
)

function renderFlow(initialEntries: string[] = ['/form']) {
  render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
      <Routes>{flow}</Routes>
      <CurrentPath />
    </MemoryRouter>,
  )
}

function currentPath(): string | null {
  return screen.getByTestId('current-path').textContent
}

/** 배경(스크림)은 카드 바깥의 닫기 버튼이다. Radix 가 aria-hidden 을 걸어 역할로 찾지 않는다 */
function scrim(): HTMLElement {
  const button = screen.getByRole('dialog').parentElement?.querySelector('button')
  if (!button) throw new Error('scrim is missing')
  return button
}

function beforeUnloadPrevented(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

describe('이탈 확인 — 앱 안 이동', () => {
  it('변경이 없으면 묻지 않고 이동한다', async () => {
    const user = userEvent.setup()
    renderFlow()
    await user.click(screen.getByRole('link', { name: '메모 다른 화면으로' }))
    expect(await screen.findByText('다른 화면')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('링크 이동을 멈추고 묻는다. 계속 작성하기는 저장해 둔 이동을 버리고 입력을 지킨다', async () => {
    const user = userEvent.setup()
    renderFlow()
    await user.type(screen.getByLabelText('메모'), '초안')
    await user.click(screen.getByRole('link', { name: '메모 다른 화면으로' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent('저장하지 않은 변경 내용이 있어요')
    expect(currentPath()).toBe('/form')
    await user.click(screen.getByRole('button', { name: '계속 작성하기' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(currentPath()).toBe('/form')
    expect(screen.getByLabelText('메모')).toHaveValue('초안')
  })

  it('코드 이동(useGuardedNavigate)도 같은 모달에서 묻는다', async () => {
    const user = userEvent.setup()
    renderFlow()
    await user.type(screen.getByLabelText('메모'), '초안')
    await user.click(screen.getByRole('button', { name: '메모 코드로 이동' }))

    expect(await screen.findAllByRole('dialog')).toHaveLength(1)
    expect(currentPath()).toBe('/form')
    await user.click(screen.getByRole('button', { name: '변경 내용 버리고 나가기' }))
    expect(await screen.findByText('다른 화면')).toBeInTheDocument()
  })

  it('Esc 는 저장해 둔 이동을 버린다', async () => {
    const user = userEvent.setup()
    renderFlow()
    await user.type(screen.getByLabelText('메모'), '초안')
    await user.click(screen.getByRole('link', { name: '메모 다른 화면으로' }))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(currentPath()).toBe('/form')
  })

  it('배경 클릭은 저장해 둔 이동을 버린다', async () => {
    const user = userEvent.setup()
    renderFlow()
    await user.type(screen.getByLabelText('메모'), '초안')
    await user.click(screen.getByRole('link', { name: '메모 다른 화면으로' }))
    await screen.findByRole('dialog')

    await user.click(scrim())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(currentPath()).toBe('/form')
  })

  it('버린 이동은 dirty 가 풀려도 저절로 이어지지 않는다', async () => {
    const user = userEvent.setup()
    renderFlow()
    await user.type(screen.getByLabelText('메모'), '초안')
    await user.click(screen.getByRole('link', { name: '메모 다른 화면으로' }))
    await user.click(await screen.findByRole('button', { name: '계속 작성하기' }))

    await user.click(screen.getByRole('button', { name: '메모 초기화' }))
    expect(currentPath()).toBe('/form')
  })

  it('변경 내용 버리고 나가기는 저장해 둔 이동을 실행한다', async () => {
    const user = userEvent.setup()
    renderFlow()
    await user.type(screen.getByLabelText('메모'), '초안')
    await user.click(screen.getByRole('link', { name: '메모 다른 화면으로' }))
    await user.click(await screen.findByRole('button', { name: '변경 내용 버리고 나가기' }))
    expect(await screen.findByText('다른 화면')).toBeInTheDocument()
    expect(currentPath()).toBe('/other')
  })

  it('키보드만으로 다룬다 — 첫 포커스는 계속 작성하기, Tab 뒤 Enter 로 나간다', async () => {
    const user = userEvent.setup()
    renderFlow()
    await user.type(screen.getByLabelText('메모'), '초안')
    await user.click(screen.getByRole('link', { name: '메모 다른 화면으로' }))
    await screen.findByRole('dialog')

    await waitFor(() => expect(screen.getByRole('button', { name: '계속 작성하기' })).toHaveFocus())
    await user.tab()
    expect(screen.getByRole('button', { name: '변경 내용 버리고 나가기' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('다른 화면')).toBeInTheDocument()
  })

  it('등록이 여럿이어도 모달은 하나이고, 전부 풀려야 묻지 않는다', async () => {
    const user = userEvent.setup()
    renderFlow(['/two-forms'])
    await user.type(screen.getByLabelText('메모'), '초안')
    await user.type(screen.getByLabelText('제목'), '제목 초안')

    await user.click(screen.getByRole('link', { name: '메모 다른 화면으로' }))
    expect(await screen.findAllByRole('dialog')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '계속 작성하기' }))

    await user.click(screen.getByRole('button', { name: '메모 초기화' }))
    await user.click(screen.getByRole('link', { name: '메모 다른 화면으로' }))
    expect(await screen.findAllByRole('dialog')).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: '계속 작성하기' }))

    await user.click(screen.getByRole('button', { name: '제목 초기화' }))
    await user.click(screen.getByRole('link', { name: '메모 다른 화면으로' }))
    expect(await screen.findByText('다른 화면')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('저장으로 등록을 푼 직후의 이동은 묻지 않는다', async () => {
    const user = userEvent.setup()
    renderFlow()
    await user.type(screen.getByLabelText('메모'), '초안')
    await user.click(screen.getByRole('button', { name: '메모 저장' }))
    expect(await screen.findByText('다른 화면')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('초기화로 dirty 가 풀리면 묻지 않는다', async () => {
    const user = userEvent.setup()
    renderFlow()
    await user.type(screen.getByLabelText('메모'), '초안')
    await user.click(screen.getByRole('button', { name: '메모 초기화' }))
    await user.click(screen.getByRole('link', { name: '메모 다른 화면으로' }))
    expect(await screen.findByText('다른 화면')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('검색 파라미터만 바뀌는 이동은 묻지 않는다', async () => {
    const user = userEvent.setup()
    renderFlow()
    await user.type(screen.getByLabelText('메모'), '초안')
    await user.click(screen.getByRole('link', { name: '메모 탭 바꾸기' }))
    await waitFor(() => expect(currentPath()).toBe('/form?tab=2'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('새로고침·탭 닫기는 dirty 인 동안만 브라우저 경고를 건다', async () => {
    const user = userEvent.setup()
    renderFlow()
    expect(beforeUnloadPrevented()).toBe(false)

    await user.type(screen.getByLabelText('메모'), '초안')
    expect(beforeUnloadPrevented()).toBe(true)

    await user.click(screen.getByRole('button', { name: '메모 초기화' }))
    expect(beforeUnloadPrevented()).toBe(false)
  })
})

/*
 * MemoryRouter 는 window.history 를 쓰지 않아 popstate 가 생기지 않는다.
 * 이 묶음만 jsdom 의 실제 기록 위에서 BrowserRouter 로 돈다 (제안서 §6-10).
 */
describe('이탈 확인 — 뒤로가기 (popstate)', () => {
  function renderInBrowser() {
    window.history.replaceState(null, '', '/start')
    window.history.pushState(null, '', '/form')
    render(
      <BrowserRouter>
        <Routes>{flow}</Routes>
        <CurrentPath />
      </BrowserRouter>,
    )
  }

  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('변경이 없으면 묻지 않고 뒤로 간다', async () => {
    renderInBrowser()
    window.history.back()
    expect(await screen.findByText('시작 화면')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('보던 주소로 되돌린 뒤 묻는다. 계속 작성하기는 그 뒤로가기를 버리고 입력을 지킨다', async () => {
    const user = userEvent.setup()
    renderInBrowser()
    await user.type(screen.getByLabelText('메모'), '초안')

    window.history.back()
    expect(await screen.findByRole('dialog')).toHaveTextContent('저장하지 않은 변경 내용이 있어요')
    expect(window.location.pathname).toBe('/form')
    expect(currentPath()).toBe('/form')
    // 다음 화면이 한 프레임 그려졌다면 작성 중인 화면이 다시 마운트되어 입력이 비었을 것이다 (§6-9)
    expect(screen.getByLabelText('메모')).toHaveValue('초안')

    await user.click(screen.getByRole('button', { name: '계속 작성하기' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(currentPath()).toBe('/form')
  })

  it('변경 내용 버리고 나가기를 고르면 그 뒤로가기를 다시 한다', async () => {
    const user = userEvent.setup()
    renderInBrowser()
    await user.type(screen.getByLabelText('메모'), '초안')

    window.history.back()
    await user.click(await screen.findByRole('button', { name: '변경 내용 버리고 나가기' }))
    expect(await screen.findByText('시작 화면')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/start')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
